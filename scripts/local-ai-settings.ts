export function localAiSettings(env: NodeJS.ProcessEnv = process.env) {
  const cpuOnly = env.INTAKE_AI_CPU_ONLY === "1" || env.INTAKE_REVIEW_CPU_ONLY === "1";
  if (cpuOnly) return { imageSize: 768, options: { num_thread: 4, num_gpu: 0 } };
  return { imageSize: 1280, options: { num_thread: 8, num_gpu: 999 } };
}
