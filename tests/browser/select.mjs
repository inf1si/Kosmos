// Helpers for the app dropdown (src/components/select.tsx). It is a combobox button with a listbox popup, not a native
// <select>, so Playwright's selectOption()/inputValue() do not apply.

const attribute = value => String(value).replace(/["\\]/g, '\\$&');

/** Opens the dropdown and picks an option by value, or by visible label with { label }. */
export async function chooseOption(combobox, option) {
    await combobox.click();
    const list = combobox.page().locator('.select-menu[role="listbox"]');
    const item = option.label !== undefined ? list.getByRole('option', { name: option.label, exact: true }) : list.locator(`[role="option"][data-value="${attribute(option)}"]`);
    await item.click();
    await list.waitFor({ state: 'hidden' });
}

/** The selected value, as native select.value would report it. */
export const selectedValue = combobox => combobox.getAttribute('data-value');

/** Opens the dropdown, reads every option, and closes it again with Escape. */
export async function readOptions(combobox) {
    await combobox.click();
    const list = combobox.page().locator('.select-menu[role="listbox"]');
    await list.waitFor();
    const options = await list.getByRole('option').evaluateAll(items => items.map(item => ({ value: item.getAttribute('data-value'), label: item.textContent.trim() })));
    await combobox.page().keyboard.press('Escape');
    await list.waitFor({ state: 'hidden' });

    return options;
}
