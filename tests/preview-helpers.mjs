export async function openPreview(editor, errors) {
  const opened = editor.waitForEvent('popup');
  await editor.getByRole('button', { name: '预览原型', exact: true }).click();
  const preview = await opened;
  preview.on('pageerror', error => errors.push(error.message));
  await preview.locator('.preview-page').waitFor();
  return preview;
}
