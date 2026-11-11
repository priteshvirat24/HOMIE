import { useLocalSearchParams } from 'expo-router';
import { WalkthroughView } from '../../../../../components/WalkthroughView';

/** Walk through this room. Other finished rooms of the house are one tap away in the viewer's room bar. */
export default function ViewerScreen() {
  const { id: propertyId, roomId } = useLocalSearchParams<{ id: string; roomId: string }>();
  return <WalkthroughView propertyId={propertyId} roomId={roomId} />;
}
