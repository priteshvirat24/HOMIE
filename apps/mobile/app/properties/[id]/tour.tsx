import { useLocalSearchParams } from 'expo-router';
import { WalkthroughView } from '../../../components/WalkthroughView';

/** Whole-house walkthrough: every room that has finished processing, switchable in the viewer. */
export default function HouseTourScreen() {
  const { id: propertyId } = useLocalSearchParams<{ id: string }>();
  return <WalkthroughView propertyId={propertyId} />;
}
