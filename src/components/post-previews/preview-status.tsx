const statusLines = [
  {
    channel: "Facebook",
    sentence:
      "Preview only. After approval, Send to Buffer sends this card to Facebook.",
  },
  {
    channel: "Google Business",
    sentence:
      "Preview only. After approval, Send to Buffer sends this card to Google Business.",
  },
  {
    channel: "Instagram",
    sentence:
      "Preview only. Instagram is not connected, so this card is not sent.",
  },
  {
    channel: "Meta ad",
    sentence: "Ad draft. This card is not running and is not sent.",
  },
  {
    channel: "Google ad",
    sentence: "Ad draft. This card is not running and is not sent.",
  },
] as const;

const byChannel = {
  facebook: statusLines[0],
  instagram: statusLines[2],
  "google-business": statusLines[1],
  "meta-ad": statusLines[3],
  "google-ad": statusLines[4],
} as const;

export function PreviewStatus({ active }: { active: keyof typeof byChannel }) {
  const line = byChannel[active];
  return (
    <p className="text-sm text-slate-600">
      <span className="font-medium text-slate-800">{line.channel}: </span>
      {line.sentence}
    </p>
  );
}
