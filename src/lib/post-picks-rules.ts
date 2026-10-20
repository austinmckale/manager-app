/** Rules the Pick posts page shares with the browser. No server code here. */

/** A job sent to Buffer this recently is not offered again, so nothing posts twice by accident. */
export const PICK_RECENT_DAYS = 90;
/** How long "Skip" hides a post from the picks. */
export const PICK_SKIP_DAYS = 30;

export type PickChannel = { id: string; service: string; name: string };

/**
 * Which photos each saved channel gets, the same limits as the send page: Facebook up to 10 in
 * order, Google Business the first photo. Instagram is not posted from the picks yet.
 */
export function bufferSelections(channels: readonly PickChannel[], assetIds: readonly string[]) {
  return channels
    .flatMap((channel) => channel.service === "facebook" ? [{ channelId: channel.id, assetIds: assetIds.slice(0, 10) }]
      : channel.service === "googlebusiness" ? [{ channelId: channel.id, assetIds: assetIds.slice(0, 1) }]
      : [])
    .filter((selection) => selection.assetIds.length > 0)
    .slice(0, 3);
}
