import { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert,
  ActivityIndicator, SafeAreaView, Dimensions,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { captureApi } from '../../../../../services/api';
import { Colors, Spacing, FontSize, Radius } from '../../../../../constants/theme';

const { width: W, height: H } = Dimensions.get('window');

const GUIDE_TIPS = [
  '📐 Face the widest wall straight-on',
  '💡 Ensure good lighting — avoid backlighting',
  '🔍 Capture the full room height',
  '📏 Step back to include as much as possible',
];

export default function CaptureScreen() {
  const { id: propertyId, roomId } = useLocalSearchParams<{ id: string; roomId: string }>();
  const router = useRouter();

  const [permission, requestPermission] = useCameraPermissions();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [capturedPhotos, setCapturedPhotos] = useState<string[]>([]);
  const [currentTip, setCurrentTip] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const cameraRef = useRef<CameraView>(null);

  // Rotate guide tips
  useEffect(() => {
    const t = setInterval(() => setCurrentTip((c) => (c + 1) % GUIDE_TIPS.length), 3500);
    return () => clearInterval(t);
  }, []);

  // Init capture session
  useEffect(() => {
    if (!roomId) return;
    captureApi.create(roomId).then((s) => setSessionId(s.id)).catch(console.error);
  }, [roomId]);

  const takePhoto = useCallback(async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.92,
        skipProcessing: false,
      });
      if (photo?.uri) {
        setCapturedPhotos((prev) => [...prev, photo.uri]);
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to capture photo');
    } finally {
      setCapturing(false);
    }
  }, [capturing]);

  const pickFromGallery = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.92,
    });
    if (!result.canceled) {
      setCapturedPhotos((prev) => [...prev, ...result.assets.map((a) => a.uri)]);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!sessionId || capturedPhotos.length === 0 || !roomId || !propertyId) return;
    setSubmitting(true);

    try {
      // Register frames in session
      for (const uri of capturedPhotos) {
        await captureApi.registerFrame(sessionId, {
          original_filename: uri.split('/').pop(),
          content_type: 'image/jpeg',
          is_accepted: true,
          captured_at: new Date().toISOString(),
        });
      }

      // Finalize the session
      await captureApi.finalize(sessionId);

      // Start reconstruction job
      const job = await import('../../../../../services/api').then((m) =>
        m.reconstructionApi.create(sessionId, 'image_blaster')
      );

      router.replace(`/properties/${propertyId}/rooms/${roomId}/processing?jobId=${job.id}&sessionId=${sessionId}`);
    } catch (e) {
      Alert.alert('Error', 'Failed to submit for reconstruction. Please try again.');
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  }, [sessionId, capturedPhotos, roomId, propertyId, router]);

  if (!permission) {
    return <View style={styles.container}><ActivityIndicator color={Colors.primary} /></View>;
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permTitle}>Camera Permission Required</Text>
        <Text style={styles.permSub}>HOMIE needs camera access to capture your room</Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>Grant Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Camera Viewfinder */}
      <CameraView ref={cameraRef} style={styles.camera} facing={facing}>
        {/* Guide overlay */}
        <View style={styles.overlay}>
          {/* Corner guides */}
          <View style={styles.guideTopLeft} />
          <View style={styles.guideTopRight} />
          <View style={styles.guideBottomLeft} />
          <View style={styles.guideBottomRight} />

          {/* Top bar */}
          <SafeAreaView style={styles.topBar}>
            <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
            <View style={styles.photoCount}>
              <Text style={styles.photoCountText}>{capturedPhotos.length} photo{capturedPhotos.length !== 1 ? 's' : ''}</Text>
            </View>
            <TouchableOpacity onPress={() => setFacing(f => f === 'back' ? 'front' : 'back')} style={styles.flipBtn}>
              <Text style={styles.flipBtnText}>⟳</Text>
            </TouchableOpacity>
          </SafeAreaView>

          {/* Guide tip */}
          <View style={styles.tipBanner}>
            <Text style={styles.tipText}>{GUIDE_TIPS[currentTip]}</Text>
          </View>

          {/* Bottom controls */}
          <View style={styles.bottomControls}>
            {/* Gallery button */}
            <TouchableOpacity style={styles.sideBtn} onPress={pickFromGallery}>
              <Text style={styles.sideBtnIcon}>🖼️</Text>
              <Text style={styles.sideBtnLabel}>Gallery</Text>
            </TouchableOpacity>

            {/* Shutter */}
            <TouchableOpacity style={styles.shutter} onPress={takePhoto} disabled={capturing}>
              {capturing ? (
                <ActivityIndicator color="#000" size="large" />
              ) : (
                <View style={styles.shutterInner} />
              )}
            </TouchableOpacity>

            {/* Submit button */}
            <TouchableOpacity
              style={[styles.sideBtn, capturedPhotos.length === 0 && { opacity: 0.3 }]}
              onPress={handleSubmit}
              disabled={capturedPhotos.length === 0 || submitting}
            >
              {submitting ? (
                <ActivityIndicator color={Colors.primary} size="small" />
              ) : (
                <>
                  <Text style={styles.sideBtnIcon}>✓</Text>
                  <Text style={[styles.sideBtnLabel, { color: capturedPhotos.length > 0 ? Colors.accent : Colors.textMuted }]}>
                    Generate
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  camera: { flex: 1 },
  overlay: { flex: 1 },
  guideTopLeft: { position: 'absolute', top: 120, left: 30, width: 40, height: 40, borderTopWidth: 3, borderLeftWidth: 3, borderColor: 'rgba(255,255,255,0.6)' },
  guideTopRight: { position: 'absolute', top: 120, right: 30, width: 40, height: 40, borderTopWidth: 3, borderRightWidth: 3, borderColor: 'rgba(255,255,255,0.6)' },
  guideBottomLeft: { position: 'absolute', bottom: 180, left: 30, width: 40, height: 40, borderBottomWidth: 3, borderLeftWidth: 3, borderColor: 'rgba(255,255,255,0.6)' },
  guideBottomRight: { position: 'absolute', bottom: 180, right: 30, width: 40, height: 40, borderBottomWidth: 3, borderRightWidth: 3, borderColor: 'rgba(255,255,255,0.6)' },
  topBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 10,
  },
  closeBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  photoCount: { backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: Radius.full, paddingHorizontal: 14, paddingVertical: 7 },
  photoCountText: { color: '#fff', fontWeight: '700', fontSize: FontSize.sm },
  flipBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  flipBtnText: { color: '#fff', fontSize: 22 },
  tipBanner: {
    position: 'absolute', top: H * 0.12, left: 20, right: 20,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: Radius.md,
    padding: 10, alignItems: 'center',
  },
  tipText: { color: 'rgba(255,255,255,0.85)', fontSize: FontSize.sm, textAlign: 'center' },
  bottomControls: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingBottom: 50, paddingTop: 20,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sideBtn: { alignItems: 'center', gap: 4, minWidth: 60 },
  sideBtnIcon: { fontSize: 28 },
  sideBtnLabel: { fontSize: FontSize.xs, color: '#fff', fontWeight: '600' },
  shutter: {
    width: 76, height: 76, borderRadius: 38,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
    borderWidth: 4, borderColor: 'rgba(255,255,255,0.4)',
    shadowColor: '#fff', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 12,
  },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },
  permTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center', marginBottom: 8 },
  permSub: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', marginBottom: 24 },
  permBtn: { backgroundColor: Colors.primary, borderRadius: Radius.md, paddingHorizontal: 24, paddingVertical: 12 },
  permBtnText: { color: '#fff', fontWeight: '700', fontSize: FontSize.md },
});
