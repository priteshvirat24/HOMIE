import { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, Dimensions, Image, ScrollView,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { captureApi, reconstructionApi, MAX_PHOTOS_PER_ROOM } from '../../../../../services/api';
import { Colors, FontSize, Radius } from '../../../../../constants/theme';

const { height: H } = Dimensions.get('window');

// World Labs builds the room from 1 photo, or from up to 8 photos of the same room from different angles.
const GUIDE_TIPS = [
  'Stand in a corner and capture the whole room',
  'Add more angles: turn ~90° and shoot again',
  'Keep the phone level and at chest height',
  'Bright, even light works best — avoid shooting into windows',
  'Use the same zoom for every photo',
];

interface Photo {
  uri: string;
  mimeType: string;
}

export default function CaptureScreen() {
  const { id: propertyId, roomId } = useLocalSearchParams<{ id: string; roomId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [permission, requestPermission] = useCameraPermissions();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [currentTip, setCurrentTip] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const cameraRef = useRef<CameraView>(null);
  const full = photos.length >= MAX_PHOTOS_PER_ROOM;

  useEffect(() => {
    const t = setInterval(() => setCurrentTip((c) => (c + 1) % GUIDE_TIPS.length), 4000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!roomId) return;
    captureApi.create(roomId)
      .then((s) => setSessionId(s.id))
      .catch((e) => Alert.alert('Cannot reach HOMIE server', String(e?.message ?? e)));
  }, [roomId]);

  const addPhotos = useCallback((more: Photo[]) => {
    setPhotos((prev) => {
      const next = [...prev, ...more];
      if (next.length > MAX_PHOTOS_PER_ROOM) {
        Alert.alert('Photo limit', `A room can use up to ${MAX_PHOTOS_PER_ROOM} photos. Extra photos were left out.`);
      }
      return next.slice(0, MAX_PHOTOS_PER_ROOM);
    });
  }, []);

  const takePhoto = useCallback(async () => {
    if (!cameraRef.current || capturing || full) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.9, exif: false });
      if (photo?.uri) addPhotos([{ uri: photo.uri, mimeType: 'image/jpeg' }]);
    } catch {
      Alert.alert('Error', 'Failed to take the photo');
    } finally {
      setCapturing(false);
    }
  }, [capturing, full, addPhotos]);

  const pickFromGallery = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_PHOTOS_PER_ROOM - photos.length,
      quality: 0.9,
    });
    if (!result.canceled) {
      addPhotos(result.assets.map((a) => ({ uri: a.uri, mimeType: a.mimeType ?? 'image/jpeg' })));
    }
  }, [photos.length, addPhotos]);

  const handleSubmit = useCallback(async () => {
    if (!sessionId || photos.length === 0 || !roomId || !propertyId) return;
    try {
      for (let i = 0; i < photos.length; i++) {
        setSubmitting(`Uploading photo ${i + 1} of ${photos.length}…`);
        await captureApi.uploadPhoto(sessionId, photos[i].uri, photos[i].mimeType);
      }
      setSubmitting('Starting 3D generation…');
      await captureApi.finalize(sessionId);
      const job = await reconstructionApi.create(sessionId, 'image_blaster');
      router.replace(`/properties/${propertyId}/rooms/${roomId}/processing?jobId=${job.id}`);
    } catch (e: any) {
      Alert.alert('Could not start', e?.message ?? 'Upload failed. Check that the HOMIE server is reachable.');
      // Photos already uploaded stay in this session; start a fresh session for the next attempt.
      captureApi.create(roomId).then((s) => setSessionId(s.id)).catch(() => {});
    } finally {
      setSubmitting(null);
    }
  }, [sessionId, photos, roomId, propertyId, router]);

  if (!permission) {
    return <View style={styles.container}><ActivityIndicator color={Colors.primary} /></View>;
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permTitle}>Camera access needed</Text>
        <Text style={styles.permSub}>HOMIE uses the camera to photograph your room. You can also pick existing photos.</Text>
        <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
          <Text style={styles.permBtnText}>Allow camera</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.permBtn, styles.permBtnSecondary]} onPress={pickFromGallery}>
          <Text style={styles.permBtnText}>Choose from gallery</Text>
        </TouchableOpacity>
        {photos.length > 0 && (
          <TouchableOpacity style={[styles.permBtn, { backgroundColor: Colors.accent }]} onPress={handleSubmit} disabled={!!submitting}>
            <Text style={styles.permBtnText}>{submitting ?? `Build 3D room from ${photos.length} photo${photos.length > 1 ? 's' : ''}`}</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />

      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.roundBtn} accessibilityLabel="Close">
          <Text style={styles.roundBtnText}>✕</Text>
        </TouchableOpacity>
        <View style={styles.photoCount}>
          <Text style={styles.photoCountText}>{photos.length} / {MAX_PHOTOS_PER_ROOM} photos</Text>
        </View>
        <View style={{ width: 40 }} />
      </View>

      <View style={[styles.tipBanner, { top: insets.top + 64 }]}>
        <Text style={styles.tipText}>{GUIDE_TIPS[currentTip]}</Text>
      </View>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 24 }]}>
        {photos.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
            {photos.map((p, i) => (
              <TouchableOpacity
                key={p.uri + i}
                onPress={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                accessibilityLabel={`Remove photo ${i + 1}`}
              >
                <Image source={{ uri: p.uri }} style={styles.thumb} />
                <View style={styles.thumbX}><Text style={styles.thumbXText}>✕</Text></View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        <View style={styles.controls}>
          <TouchableOpacity style={styles.sideBtn} onPress={pickFromGallery} disabled={full || !!submitting}>
            <Text style={styles.sideBtnIcon}>🖼️</Text>
            <Text style={styles.sideBtnLabel}>Gallery</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.shutter, full && { opacity: 0.3 }]}
            onPress={takePhoto}
            disabled={capturing || full || !!submitting}
            accessibilityLabel="Take photo"
          >
            {capturing ? <ActivityIndicator color="#000" size="large" /> : <View style={styles.shutterInner} />}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.sideBtn, (photos.length === 0 || !sessionId) && { opacity: 0.3 }]}
            onPress={handleSubmit}
            disabled={photos.length === 0 || !sessionId || !!submitting}
          >
            {submitting ? (
              <ActivityIndicator color={Colors.accent} size="small" />
            ) : (
              <>
                <Text style={styles.sideBtnIcon}>✓</Text>
                <Text style={[styles.sideBtnLabel, { color: photos.length > 0 ? Colors.accent : Colors.textMuted }]}>Build 3D</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
        {submitting && <Text style={styles.submittingText}>{submitting}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16,
  },
  roundBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  roundBtnText: { color: '#fff', fontSize: 18, fontWeight: '600' },
  photoCount: { backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: Radius.full, paddingHorizontal: 14, paddingVertical: 7 },
  photoCountText: { color: '#fff', fontWeight: '700', fontSize: FontSize.sm },
  tipBanner: {
    position: 'absolute', left: 20, right: 20,
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: Radius.md, padding: 10, alignItems: 'center',
  },
  tipText: { color: 'rgba(255,255,255,0.9)', fontSize: FontSize.sm, textAlign: 'center' },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.6)', paddingTop: 12 },
  strip: { paddingHorizontal: 16, gap: 8, paddingBottom: 12 },
  thumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: '#222' },
  thumbX: {
    position: 'absolute', top: -4, right: -4, width: 18, height: 18, borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.8)', alignItems: 'center', justifyContent: 'center',
  },
  thumbXText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', minHeight: H * 0.1 },
  sideBtn: { alignItems: 'center', gap: 4, minWidth: 64 },
  sideBtnIcon: { fontSize: 26, color: '#fff' },
  sideBtnLabel: { fontSize: FontSize.xs, color: '#fff', fontWeight: '600' },
  shutter: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: 'rgba(255,255,255,0.4)',
  },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#fff' },
  submittingText: { color: '#fff', textAlign: 'center', marginTop: 10, fontSize: FontSize.sm },
  permTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  permSub: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', marginBottom: 12 },
  permBtn: { backgroundColor: Colors.primary, borderRadius: Radius.md, paddingHorizontal: 24, paddingVertical: 12, minWidth: 240, alignItems: 'center' },
  permBtnSecondary: { backgroundColor: Colors.bgElevated },
  permBtnText: { color: '#fff', fontWeight: '700', fontSize: FontSize.md },
});
