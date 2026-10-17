// Capture focus with quick-question bubbles is on by default. Checks that cover
// the older flow (crop → assistant opens with the screenshot) switch it off
// through the app's own settings store, without reloading the page.
export async function useClassicCapture(page) {
  await page.evaluate(async () => {
    const { useSettings } = await import('/src/settings/index.ts');
    const settings = useSettings();
    const current = await settings.load();
    await settings.save({ ...current, pdf: { ...current.pdf, quickAskOnCapture: false } });
  });
}
