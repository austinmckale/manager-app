"use client";

type Props = {
  workerId: string;
  isActive: boolean;
  action: (formData: FormData) => Promise<void>;
  confirmMessage: string;
  label: string;
  className?: string;
};

export function ConfirmDeactivateForm({ workerId, isActive, action, confirmMessage, label, className }: Props) {
  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (!confirm(confirmMessage)) {
      e.preventDefault();
    }
  }

  return (
    <form action={action} onSubmit={handleSubmit} className={className ?? "mt-2 inline-block"}>
      <input type="hidden" name="workerId" value={workerId} />
      <input type="hidden" name="isActive" value={isActive ? "false" : "true"} />
      <button type="submit" className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">
        {label}
      </button>
    </form>
  );
}
