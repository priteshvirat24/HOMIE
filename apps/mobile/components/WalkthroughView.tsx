import { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { walkthroughUrl } from '../services/api';
import { Colors, FontSize, Radius } from '../constants/theme';

/**
 * Full-screen 3D walkthrough. The viewer (apps/viewer) is served by the API at /viewer/ and
 * loads scenes itself, so this screen only has to point the WebView at the right URL.
 */
export function WalkthroughView({ propertyId, roomId }: { propertyId?: string; roomId?: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const uri = walkthroughUrl({ propertyId, roomId });

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      router.back();
      return true;
    });
    return () => sub.remove();
  }, [router]);

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Can't reach the 3D viewer</Text>
        <Text style={styles.errorSub}>{error}</Text>
        <Text style={styles.errorHint}>{uri}</Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <TouchableOpacity style={styles.btnSecondary} onPress={() => router.back()}>
            <Text style={styles.btnText}>Back</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btn} onPress={() => { setError(null); setReloadKey((k) => k + 1); }}>
            <Text style={styles.btnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WebView
        key={reloadKey}
        source={{ uri }}
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
        allowsInlineMediaPlayback
        bounces={false}
        overScrollMode="never"
        setSupportMultipleWindows={false}
        startInLoadingState
        renderLoading={() => (
          <View style={[StyleSheet.absoluteFill, styles.center]}>
            <ActivityIndicator color={Colors.primary} size="large" />
          </View>
        )}
        onError={(e) => setError(e.nativeEvent.description || 'Network error')}
        onHttpError={(e) => setError(`The viewer returned HTTP ${e.nativeEvent.statusCode}. Is it built? (npm run build:viewer)`)}
      />
      <TouchableOpacity
        style={[styles.exitBtn, { top: insets.top + 64 }]}
        onPress={() => router.back()}
        accessibilityLabel="Close 3D view"
      >
        <Text style={styles.exitBtnText}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  webview: { flex: 1, backgroundColor: '#0b0c0e' },
  center: { flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  exitBtn: {
    position: 'absolute', right: 12,
    width: 40, height: 40, borderRadius: 12,
    backgroundColor: 'rgba(18,18,22,0.7)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center', justifyContent: 'center',
  },
  exitBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  errorTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  errorSub: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center' },
  errorHint: { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'center', marginBottom: 12 },
  btn: { backgroundColor: Colors.primary, borderRadius: Radius.md, paddingHorizontal: 20, paddingVertical: 12 },
  btnSecondary: { backgroundColor: Colors.bgElevated, borderRadius: Radius.md, paddingHorizontal: 20, paddingVertical: 12 },
  btnText: { color: '#fff', fontWeight: '700' },
});
