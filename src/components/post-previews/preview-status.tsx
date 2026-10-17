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

export function PreviewStatus() {
  return (
    <ul className="space-y-1 text-sm text-slate-600">
      {statusLines.map(({ channel, sentence }) => (
        <li key={channel}>
          <span className="font-medium text-slate-800">{channel}: </span>
          {sentence}
        </li>
      ))}
    </ul>
  );
}
