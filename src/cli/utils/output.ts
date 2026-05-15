export function formatOutput<T = unknown>(
  result: { success: boolean; data?: T; error?: { code: string; message: string } },
  options: { json?: boolean; tty?: boolean } = {}
): void {
  const isJson = options.json || !options.tty;

  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
    if (!result.success) process.exit(1);
    return;
  }

  if (result.success) {
    console.log(`✅ Success`);
    if (result.data) {
      console.log(JSON.stringify(result.data, null, 2));
    }
  } else {
    console.error(`❌ Error [${result.error?.code}]: ${result.error?.message}`);
    process.exit(1);
  }
}
