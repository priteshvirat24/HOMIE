import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  RefreshControl, Modal, TextInput, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { roomsApi, propertiesApi, type Room, type Property } from '../../../services/api';
import { Colors, Spacing, FontSize, Radius } from '../../../constants/theme';

const ROOM_TYPE_ICONS: Record<string, string> = {
  living_room: '🛋️', bedroom: '🛏️', kitchen: '🍳', bathroom: '🚿',
  dining_room: '🍽️', hallway: '🚪', balcony: '🌿', office: '💻',
  garage: '🚗', laundry: '👕', other: '📦',
};

const ROOM_TYPES = [
  { value: 'living_room', label: 'Living Room' },
  { value: 'bedroom', label: 'Bedroom' },
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'bathroom', label: 'Bathroom' },
  { value: 'dining_room', label: 'Dining Room' },
  { value: 'office', label: 'Office' },
  { value: 'other', label: 'Other' },
];

const STATUS_COLORS: Record<string, string> = {
  created: Colors.textMuted, capturing: Colors.warning, captured: Colors.accent,
  uploading: Colors.primary, uploaded: Colors.primary, processing: Colors.warning,
  ready: Colors.success, failed: Colors.danger,
};

export default function PropertyScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [property, setProperty] = useState<Property | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('living_room');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [prop, roomList] = await Promise.all([
        propertiesApi.get(id),
        roomsApi.list(id),
      ]);
      setProperty(prop);
      setRooms(roomList);
    } catch (e) {
      console.error('Failed to load property:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!newName.trim() || !id) return;
    setCreating(true);
    try {
      await roomsApi.create(id, { name: newName.trim(), room_type: newType });
      setNewName('');
      setNewType('living_room');
      setShowCreate(false);
      load();
    } catch (e) {
      Alert.alert('Error', 'Failed to create room');
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={Colors.primary} size="large" /></View>;
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{property?.name ?? 'Property'}</Text>
          {property?.address ? <Text style={styles.headerSub}>{property.address}</Text> : null}
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={() => setShowCreate(true)}>
          <Text style={styles.addBtnText}>+ Room</Text>
        </TouchableOpacity>
      </View>

      {rooms.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🚪</Text>
          <Text style={styles.emptyTitle}>No rooms yet</Text>
          <Text style={styles.emptySub}>Add your first room to start capturing</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => setShowCreate(true)}>
            <Text style={styles.emptyBtnText}>Add Room</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={rooms}
          keyExtractor={(r) => r.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.primary} />}
          contentContainerStyle={{ padding: Spacing.md, gap: 12 }}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.card}
              onPress={() => router.push(`/properties/${id}/rooms/${item.id}`)}
            >
              <View style={styles.cardIcon}>
                <Text style={{ fontSize: 28 }}>{ROOM_TYPE_ICONS[item.room_type] ?? '📦'}</Text>
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>{item.name}</Text>
                <Text style={styles.cardType}>{item.room_type.replace(/_/g, ' ')}</Text>
              </View>
              <View style={[styles.statusBadge, { borderColor: STATUS_COLORS[item.status] ?? Colors.border }]}>
                <Text style={[styles.statusText, { color: STATUS_COLORS[item.status] ?? Colors.textMuted }]}>
                  {item.status}
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          )}
        />
      )}

      {/* Create Room Modal */}
      <Modal visible={showCreate} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>New Room</Text>
            <TextInput
              style={styles.input}
              placeholder="Room name (e.g. Master Bedroom)"
              placeholderTextColor={Colors.textMuted}
              value={newName}
              onChangeText={setNewName}
              autoFocus
            />
            <Text style={styles.label}>Room type</Text>
            <View style={styles.typeGrid}>
              {ROOM_TYPES.map((t) => (
                <TouchableOpacity
                  key={t.value}
                  style={[styles.typeChip, newType === t.value && styles.typeChipSelected]}
                  onPress={() => setNewType(t.value)}
                >
                  <Text style={{ fontSize: 16 }}>{ROOM_TYPE_ICONS[t.value]}</Text>
                  <Text style={[styles.typeLabel, newType === t.value && { color: Colors.primary }]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowCreate(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmBtn, (!newName.trim() || creating) && { opacity: 0.5 }]}
                onPress={handleCreate}
                disabled={!newName.trim() || creating}
              >
                {creating ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.confirmBtnText}>Create</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md,
    paddingTop: 60, paddingBottom: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: { paddingRight: 12 },
  backText: { fontSize: FontSize.lg, color: Colors.primary },
  headerCenter: { flex: 1 },
  headerTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.textPrimary },
  headerSub: { fontSize: FontSize.xs, color: Colors.textSecondary },
  addBtn: { backgroundColor: Colors.primary, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 7 },
  addBtnText: { color: '#fff', fontWeight: '600', fontSize: FontSize.sm },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  emptyIcon: { fontSize: 64, marginBottom: Spacing.md },
  emptyTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.textPrimary, marginBottom: 8 },
  emptySub: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center', marginBottom: Spacing.lg },
  emptyBtn: { backgroundColor: Colors.primary, borderRadius: Radius.md, paddingHorizontal: Spacing.xl, paddingVertical: 12 },
  emptyBtnText: { color: '#fff', fontWeight: '600', fontSize: FontSize.md },
  card: {
    backgroundColor: Colors.bgCard, borderRadius: Radius.lg, borderWidth: 1,
    borderColor: Colors.border, padding: Spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: 12,
  },
  cardIcon: {
    width: 52, height: 52, borderRadius: Radius.md,
    backgroundColor: Colors.bgElevated, alignItems: 'center', justifyContent: 'center',
  },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: FontSize.md, fontWeight: '600', color: Colors.textPrimary },
  cardType: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 2, textTransform: 'capitalize' },
  statusBadge: { borderWidth: 1, borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 3 },
  statusText: { fontSize: FontSize.xs, fontWeight: '600', textTransform: 'capitalize' },
  chevron: { fontSize: 22, color: Colors.textMuted },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modal: { backgroundColor: Colors.bgCard, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: Spacing.lg, gap: Spacing.md },
  modalTitle: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.textPrimary },
  label: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textSecondary },
  input: {
    backgroundColor: Colors.bgInput, borderRadius: Radius.md, borderWidth: 1,
    borderColor: Colors.border, padding: 14, color: Colors.textPrimary, fontSize: FontSize.md,
  },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: 12, paddingVertical: 8, backgroundColor: Colors.bgInput,
  },
  typeChipSelected: { borderColor: Colors.primary, backgroundColor: Colors.infoBg },
  typeLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 4, paddingBottom: 16 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  cancelBtnText: { color: Colors.textSecondary, fontWeight: '600' },
  confirmBtn: { flex: 1, padding: 14, borderRadius: Radius.md, backgroundColor: Colors.primary, alignItems: 'center' },
  confirmBtnText: { color: '#fff', fontWeight: '700' },
});
