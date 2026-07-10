import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Alert } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { reconstructionApi, type ReconstructionJob } from '../../../../../services/api';
import { Colors, Spacing, FontSize, Radius } from '../../../../../constants/theme';

const STAGE_LABELS: Record<string, string> = {
  created: 'Preparing...', validating_input: 'Validating input...', queued: 'In queue...',
  waiting_for_worker: 'Waiting for worker...', downloading_images: 'Loading your photos...',
  preprocessing: 'Preprocessing images...', analyzing_scene: '🔍 Analyzing scene...',
  generating_world: '🌍 Generating 3D world (World Labs)...', generating_objects: '📦 Generating objects...',
  generating_sfx: '🔊 Adding sounds...', postprocessing: '✨ Finalizing scene...',
  optimizing: '⚡ Optimizing for mobile...', generating_preview: '🖼️ Creating preview...',
  uploading_artifacts: '☁️ Uploading scene...', ready: '✅ Done!',
  failed: '❌ Failed', cancelled: 'Cancelled',
};

export default function ProcessingScreen() {
  const { id: propertyId, roomId, jobId } = useLocalSearchParams<{
    id: string; roomId: string; jobId: string;
  }>();
  const router = useRouter();

  const [job, setJob] = useState<ReconstructionJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pulseAnim = useRef(new Animated.Value(0.8)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Pulse animation for the icon
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.8, duration: 900, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, []);

  const poll = useCallback(async () => {
    if (!jobId) return;
    try {
      const progress = await reconstructionApi.progress(jobId);
      setJob((prev) => ({ ...(prev ?? {} as ReconstructionJob), ...progress, id: jobId }));

      // Animate progress bar
      Animated.timing(progressAnim, {
        toValue: progress.progress,
        duration: 500,
        useNativeDriver: false,
      }).start();

      if (progress.status === 'ready') {
        clearInterval(pollRef.current!);
        setTimeout(() => {
          router.replace(`/properties/${propertyId}/rooms/${roomId}/viewer`);
        }, 1500);
      }

      if (progress.status === 'failed') {
        clearInterval(pollRef.current!);
        setError(progress.error_message ?? 'Reconstruction failed');
      }
    } catch (e) {
      console.error('Poll error:', e);
    }
  }, [jobId, propertyId, roomId, router]);

  useEffect(() => {
    poll();
    pollRef.current = setInterval(poll, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [poll]);

  const handleCancel = () => {
    Alert.alert('Cancel Reconstruction?', 'You can restart it later from the room page.', [
      { text: 'Keep Going', style: 'cancel' },
      {
        text: 'Cancel', style: 'destructive', onPress: async () => {
          if (jobId) await reconstructionApi.cancel(jobId).catch(() => {});
          router.back();
        },
      },
    ]);
  };

  const handleRetry = async () => {
    if (!jobId) return;
    await reconstructionApi.retry(jobId).catch(() => {});
    setError(null);
    poll();
    pollRef.current = setInterval(poll, 3000);
  };

  const statusLabel = STAGE_LABELS[job?.status ?? ''] ?? 'Processing...';
  const progressPct = Math.round((job?.progress ?? 0) * 100);
  const isFailed = job?.status === 'failed';
  const isReady = job?.status === 'ready';

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Generating 3D Room</Text>
        <Text style={styles.headerSub}>Powered by World Labs AI</Text>
      </View>

      {/* Main status card */}
      <View style={styles.card}>
        <Animated.Text style={[styles.mainIcon, { transform: [{ scale: pulseAnim }] }]}>
          {isFailed ? '❌' : isReady ? '✅' : '🌍'}
        </Animated.Text>

        <Text style={styles.statusLabel}>{statusLabel}</Text>

        {job?.current_message && !isFailed && (
          <Text style={styles.statusDetail}>{job.current_message}</Text>
        )}

        {/* Progress bar */}
        {!isFailed && !isReady && (
          <View style={styles.progressTrack}>
            <Animated.View
              style={[
                styles.progressFill,
                {
                  width: progressAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0%', '100%'],
                  }),
                },
              ]}
            />
          </View>
        )}

        {!isFailed && !isReady && (
          <Text style={styles.progressPct}>{progressPct}%</Text>
        )}

        {/* Retry count */}
        {job?.retry_count && job.retry_count > 0 && (
          <Text style={styles.retryNote}>Attempt {job.retry_count + 1}</Text>
        )}
      </View>

      {/* Error state */}
      {isFailed && error && (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Reconstruction Failed</Text>
          <Text style={styles.errorMsg}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={handleRetry}>
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* What's happening explanation */}
      {!isFailed && !isReady && (
        <View style={styles.explainer}>
          <Text style={styles.explainerTitle}>What's happening?</Text>
          {[
            '🖼️  Analyzing your room photo with AI',
            '🌍  World Labs generates a full 360° 3D scene',
            '📱  Optimizing for mobile rendering',
          ].map((s, i) => (
            <Text key={i} style={styles.explainerItem}>{s}</Text>
          ))}
          <Text style={styles.explainerEta}>⏱️  Typically 2–5 minutes</Text>
        </View>
      )}

      {/* Cancel */}
      {!isReady && (
        <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel}>
          <Text style={styles.cancelBtnText}>{isFailed ? '← Go Back' : 'Cancel'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg, padding: Spacing.md },
  header: { paddingTop: 60, paddingBottom: Spacing.lg, alignItems: 'center' },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.textPrimary },
  headerSub: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 4 },
  card: {
    backgroundColor: Colors.bgCard, borderRadius: Radius.xl, borderWidth: 1,
    borderColor: Colors.border, padding: Spacing.xl, alignItems: 'center', gap: 14,
  },
  mainIcon: { fontSize: 72 },
  statusLabel: { fontSize: FontSize.lg, fontWeight: '600', color: Colors.textPrimary, textAlign: 'center' },
  statusDetail: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center' },
  progressTrack: {
    width: '100%', height: 6, backgroundColor: Colors.bgElevated,
    borderRadius: Radius.full, overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: Radius.full },
  progressPct: { fontSize: FontSize.md, fontWeight: '700', color: Colors.primary },
  retryNote: { fontSize: FontSize.xs, color: Colors.textMuted },
  errorCard: {
    backgroundColor: Colors.errorBg, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.danger + '44', padding: Spacing.md, gap: 10, marginTop: 12,
  },
  errorTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.danger },
  errorMsg: { fontSize: FontSize.sm, color: Colors.textSecondary },
  retryBtn: { backgroundColor: Colors.danger, borderRadius: Radius.md, padding: 12, alignItems: 'center' },
  retryBtnText: { color: '#fff', fontWeight: '700' },
  explainer: {
    backgroundColor: Colors.bgCard, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.border, padding: Spacing.md, gap: 8, marginTop: 12,
  },
  explainerTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textSecondary, marginBottom: 4 },
  explainerItem: { fontSize: FontSize.sm, color: Colors.textSecondary },
  explainerEta: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: '500', marginTop: 4 },
  cancelBtn: { marginTop: 'auto', padding: 14, alignItems: 'center' },
  cancelBtnText: { color: Colors.textMuted, fontSize: FontSize.sm },
});
