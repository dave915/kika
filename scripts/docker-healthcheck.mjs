try {
  await Promise.all(
    [process.env.PORT || 4174, process.env.RUNTIME_PORT || 4175].map(
      async (port) => {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
          signal: AbortSignal.timeout(3000),
        });
        if (!response.ok || (await response.json()).ok !== true)
          throw new Error(`Health check failed on port ${port}`);
      },
    ),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
