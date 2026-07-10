import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#09090b' },
          headerTintColor: '#fafafa',
          headerTitleStyle: { fontWeight: '600', fontSize: 17 },
          contentStyle: { backgroundColor: '#09090b' },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="properties/index" options={{ title: 'My Properties', headerShown: false }} />
        <Stack.Screen name="properties/[id]/index" options={{ title: 'Property' }} />
        <Stack.Screen name="properties/[id]/rooms/[roomId]/index" options={{ title: 'Room' }} />
        <Stack.Screen name="properties/[id]/rooms/[roomId]/capture" options={{ title: 'Capture', headerShown: false }} />
        <Stack.Screen name="properties/[id]/rooms/[roomId]/processing" options={{ title: 'Processing', headerShown: false }} />
        <Stack.Screen name="properties/[id]/rooms/[roomId]/viewer" options={{ title: '3D View', headerShown: false }} />
      </Stack>
    </>
  );
}
