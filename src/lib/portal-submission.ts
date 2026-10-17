export function portalSubmissionStatus(input: { voicePending: boolean }) {
  return input.voicePending ? "Processing your voice note" : "Received";
}
