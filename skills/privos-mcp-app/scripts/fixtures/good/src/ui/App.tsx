import { useLists, usePrivosTool } from '@privos_ai/app-react';

export function App({ roomId }: { roomId: string }) {
  const lists = useLists(roomId);
  const room = usePrivosTool('privos.rooms.get', { roomId });
  return <pre>{JSON.stringify({ lists: lists.data, room: room.data })}</pre>;
}
