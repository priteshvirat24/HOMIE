import { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, BackHandler } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { sceneApi } from '../../../../../services/api';
import { Colors, FontSize, Radius } from '../../../../../constants/theme';

const VIEWER_URL = process.env.EXPO_PUBLIC_VIEWER_URL ?? 'http://localhost:5173';

export default function ViewerScreen() {
  const { id: propertyId, roomId } = useLocalSearchParams<{ id: string; roomId: string }>();
  const router = useRouter();

  const [manifest, setManifest] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const webViewRef = useRef<WebView>(null);

  // Load scene manifest
  useEffect(() => {
    if (!roomId) return;
    sceneApi.getManifest(roomId)
      .then((m) => setManifest(m.manifest_data))
      .catch((e) => setError('No 3D scene available for this room.'))
      .finally(() => setLoading(false));
  }, [roomId]);

  // Once viewer says it's ready, send scene
  useEffect(() => {
    if (!viewerReady || !manifest || !webViewRef.current) return;
    webViewRef.current.postMessage(JSON.stringify({
      type: 'LOAD_SCENE',
      manifest,
    }));
  }, [viewerReady, manifest]);

  // Handle messages from viewer
  const onMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'VIEWER_READY') setViewerReady(true);
    } catch {}
  }, []);

  // Android back button
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      router.back();
      return true;
    });
    return () => sub.remove();
  }, [router]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} size="large" />
        <Text style={styles.loadingText}>Loading scene...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorIcon}>🏚️</Text>
        <Text style={styles.errorTitle}>Scene Not Available</Text>
        <Text style={styles.errorSub}>{error}</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>← Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Fullscreen WebView running the Three.js viewer */}
      <WebView
        ref={webViewRef}
        source={{ uri: VIEWER_URL }}
        style={styles.webview}
        onMessage={onMessage}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        javaScriptEnabled
        domStorageEnabled
        allowsFullscreenVideo={false}
        originWhitelist={['*']}
        onError={(e) => setError(`Viewer failed to load: ${e.nativeEvent.description}`)}
      />

      {/* Exit overlay button */}
      <TouchableOpacity style={styles.exitBtn} onPress={() => router.back()}>
        <Text style={styles.exitBtnText}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center', padding: 32 },
  webview: { flex: 1 },
  exitBtn: {
    position: 'absolute', top: 52, left: 16,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  exitBtnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  loadingText: { color: Colors.textSecondary, marginTop: 12, fontSize: FontSize.sm },
  errorIcon: { fontSize: 56, marginBottom: 16 },
  errorTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center', marginBottom: 8 },
  errorSub: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', marginBottom: 24 },
  backBtn: { backgroundColor: Colors.primary, borderRadius: Radius.md, paddingHorizontal: 24, paddingVertical: 12 },
  backBtnText: { color: '#fff', fontWeight: '700' },
});
