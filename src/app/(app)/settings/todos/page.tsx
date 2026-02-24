import Link from "next/link";
import { TodoBoard } from "@/components/todo-board";
import { implementationTodoGroups } from "@/lib/implementation-todos";

export default function SettingsTodosPage() {
  return (
    <div className="space-y-4">
      <Link href="/settings/targets" className="inline-flex rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-700">
        Back to Settings
      </Link>
      <TodoBoard groups={implementationTodoGroups} />
    </div>
  );
}

