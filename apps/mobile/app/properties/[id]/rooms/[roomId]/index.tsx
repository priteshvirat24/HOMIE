import { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { roomsApi, reconstructionApi, sceneApi, type Room, type ReconstructionJob } from '../../../../../services/api';
import { Colors, Spacing, FontSize, Radius } from '../../../../../constants/theme';

const ROOM_TYPE_ICONS: Record<string, string> = {
  living_room: '🛋️', bedroom: '🛏️', kitchen: '🍳', bathroom: '🚿',
  dining_room: '🍽️', hallway: '🚪', balcony: '🌿', office: '💻',
  garage: '🚗', laundry: '👕', other: '📦',
};

export default function RoomScreen() {
  const { id: propertyId, roomId } = useLocalSearchParams<{ id: string; roomId: string }>();
  const router = useRouter();
  const [room, setRoom] = useState<Room | null>(null);
  const [job, setJob] = useState<ReconstructionJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasScene, setHasScene] = useState(false);

  const load = useCallback(async () => {
    if (!propertyId || !roomId) return;
    try {
      const r = await roomsApi.get(propertyId, roomId);
      setRoom(r);

      // Check for scene
      try {
        await sceneApi.getManifest(roomId);
        setHasScene(true);
      } catch { setHasScene(false); }

    } catch (e) {
      console.error('Failed to load room:', e);
    } finally {
      setLoading(false);
    }
  }, [propertyId, roomId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={Colors.primary} size="large" /></View>;
  }

  const statusColor = ({ ready: Colors.success, failed: Colors.danger, processing: Colors.warning } as Record<string, string>)[room?.status ?? ''] ?? Colors.textMuted;
  const icon = ROOM_TYPE_ICONS[room?.room_type ?? ''] ?? '📦';

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{room?.name ?? 'Room'}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Room Hero */}
        <View style={styles.hero}>
          <Text style={styles.heroIcon}>{icon}</Text>
          <Text style={styles.heroType}>{room?.room_type?.replace(/_/g, ' ') ?? ''}</Text>
          <View style={[styles.statusPill, { borderColor: statusColor }]}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusLabel, { color: statusColor }]}>{room?.status ?? ''}</Text>
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actions}>

          {/* Capture Button */}
          <TouchableOpacity
            style={styles.primaryAction}
            onPress={() => router.push(`/properties/${propertyId}/rooms/${roomId}/capture`)}
          >
            <Text style={styles.primaryActionIcon}>📷</Text>
            <View>
              <Text style={styles.primaryActionTitle}>
                {room?.status === 'ready' ? 'Re-capture Room' : 'Capture Room'}
              </Text>
              <Text style={styles.primaryActionSub}>Take photos to generate 3D</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>

          {/* View 3D Button — only if scene ready */}
          {hasScene && (
            <TouchableOpacity
              style={[styles.primaryAction, styles.viewAction]}
              onPress={() => router.push(`/properties/${propertyId}/rooms/${roomId}/viewer`)}
            >
              <Text style={styles.primaryActionIcon}>🥽</Text>
              <View>
                <Text style={[styles.primaryActionTitle, { color: Colors.accent }]}>Explore in 3D</Text>
                <Text style={styles.primaryActionSub}>Walk through your room</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          )}

          {/* Processing status */}
          {room?.status === 'processing' && (
            <TouchableOpacity
              style={styles.secondaryAction}
              onPress={async () => {
                const job = await reconstructionApi.latestForRoom(roomId!).catch(() => null);
                if (job) router.push(`/properties/${propertyId}/rooms/${roomId}/processing?jobId=${job.id}`);
              }}
            >
              <Text style={styles.secondaryActionIcon}>⚙️</Text>
              <View>
                <Text style={styles.secondaryActionTitle}>View Processing Status</Text>
                <Text style={styles.secondaryActionSub}>AI is generating your 3D room</Text>
              </View>
              <ActivityIndicator color={Colors.warning} size="small" />
            </TouchableOpacity>
          )}
        </View>

        {/* Info */}
        <View style={styles.infoSection}>
          <Text style={styles.infoTitle}>About</Text>
          <View style={styles.infoRow}>
            <Text style={styles.infoKey}>Type</Text>
            <Text style={styles.infoVal}>{room?.room_type?.replace(/_/g, ' ') ?? '—'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoKey}>Status</Text>
            <Text style={[styles.infoVal, { color: statusColor }]}>{room?.status ?? '—'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoKey}>3D Scene</Text>
            <Text style={[styles.infoVal, { color: hasScene ? Colors.success : Colors.textMuted }]}>
              {hasScene ? 'Available' : 'Not generated'}
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md,
    paddingTop: 60, paddingBottom: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border, gap: 12,
  },
  backBtn: {},
  backText: { fontSize: FontSize.lg, color: Colors.primary },
  headerTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary, flex: 1 },
  content: { padding: Spacing.md, gap: 16 },
  hero: {
    backgroundColor: Colors.bgCard, borderRadius: Radius.xl, padding: Spacing.xl,
    alignItems: 'center', gap: 10, borderWidth: 1, borderColor: Colors.border,
  },
  heroIcon: { fontSize: 72 },
  heroType: { fontSize: FontSize.md, color: Colors.textSecondary, textTransform: 'capitalize', letterSpacing: 1 },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderRadius: Radius.full, paddingHorizontal: 14, paddingVertical: 6,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusLabel: { fontSize: FontSize.sm, fontWeight: '600', textTransform: 'capitalize' },
  actions: { gap: 10 },
  primaryAction: {
    backgroundColor: Colors.bgCard, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.primary + '44', padding: Spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: 14,
  },
  viewAction: { borderColor: Colors.accent + '44' },
  primaryActionIcon: { fontSize: 28 },
  primaryActionTitle: { fontSize: FontSize.md, fontWeight: '600', color: Colors.textPrimary },
  primaryActionSub: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  secondaryAction: {
    backgroundColor: Colors.bgCard, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.border, padding: Spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: 14,
  },
  secondaryActionIcon: { fontSize: 24 },
  secondaryActionTitle: { fontSize: FontSize.md, fontWeight: '600', color: Colors.textPrimary, flex: 1 },
  secondaryActionSub: { fontSize: FontSize.xs, color: Colors.textSecondary },
  chevron: { fontSize: 22, color: Colors.textMuted, marginLeft: 'auto' },
  infoSection: { backgroundColor: Colors.bgCard, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' },
  infoTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.textSecondary, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  infoKey: { fontSize: FontSize.sm, color: Colors.textSecondary },
  infoVal: { fontSize: FontSize.sm, fontWeight: '500', color: Colors.textPrimary, textTransform: 'capitalize' },
});
