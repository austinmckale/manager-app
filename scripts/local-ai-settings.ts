export function localAiSettings(env: NodeJS.ProcessEnv = process.env) {
  const cpuOnly = env.INTAKE_AI_CPU_ONLY === "1" || env.INTAKE_REVIEW_CPU_ONLY === "1";
  return { imageSize: cpuOnly ? 384 : 768, options: { num_thread: 4, ...(cpuOnly ? { num_gpu: 0 } : {}) } };
}
