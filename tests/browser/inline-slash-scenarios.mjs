import assert from 'node:assert/strict';

// Shared consumer regression: a command between UTF-16 text preserves both sides.
export async function inlineSlashScenarios({page,body,undo,redo,menuLabel,synced}){
  const source='앞글🙂뒤글.';
  const synthetic=()=>body().locator('p').filter({hasText:'앞글🙂'}).last();

  const caret=async(locator,offset)=>{
    await locator.evaluate((el,offset)=>{el.closest('[contenteditable]').focus();const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node,left=offset;

while((node=walker.nextNode())){if(left<=node.length){const range=document.createRange();range.setStart(node,left);range.collapse(true);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);document.dispatchEvent(new Event('selectionchange'));

return;}

left-=node.length;}

throw new Error('Missing synthetic caret');},offset);

    for(let i=0;i<20;i++){if(await locator.evaluate(el=>{const editor=el.closest('[contenteditable]').editor,s=getSelection();

return editor.state.selection.from===editor.view.posAtDOM(s.anchorNode,s.anchorOffset)&&editor.state.selection.to===editor.state.selection.from;}))return;await page.waitForTimeout(20);}

throw new Error('Caret did not reach ProseMirror');
  };

  const tail=body().locator('p').last();await caret(tail,(await tail.textContent()).length);await page.keyboard.press('End');await page.keyboard.press('Enter');await page.waitForTimeout(80);await page.keyboard.insertText(source);assert.equal(await synthetic().innerText(),source);
  const run=async(query)=>{await page.keyboard.insertText('/'+query);await page.getByRole('listbox',{name:menuLabel}).waitFor();assert(await body().evaluate(el=>el===document.activeElement));await page.keyboard.press('Enter');await page.getByRole('listbox',{name:menuLabel}).waitFor({state:'hidden'});};

  const clearQuery=async(query)=>{const p=synthetic();const text=await p.innerText(),offset=text.indexOf('/'+query);assert(offset>=0);await caret(p,offset+query.length+1);

for(let i=0;i<query.length+1;i++)await page.keyboard.press('Backspace');assert.equal(await p.innerText(),source);};

  await caret(synthetic(),4);await run('제목 2');await body().locator('h2').waitFor();assert.equal(await body().locator('h2').innerText(),source);
  await undo().click();assert.equal(await synthetic().innerText(),'앞글🙂/제목 2뒤글.');await redo().click();assert.equal(await body().locator('h2').innerText(),source);
  await caret(body().locator('h2'),4);await run('일반');assert.equal(await synthetic().innerText(),source);
  await caret(synthetic(),2);await run('글머리');assert.equal(await body().locator('li p').last().innerText(),source);
  // Slash inside the existing list paragraph, then restore the original flat paragraph.
  await caret(body().locator('li p').last(),4);await page.keyboard.insertText('/');await page.getByRole('listbox',{name:menuLabel}).waitFor();await page.keyboard.press('Escape');await page.keyboard.press('Backspace');
  await caret(body().locator('li p').last(),4);await run('글머리');assert.equal(await synthetic().innerText(),source);assert.equal(await synthetic().evaluate(el=>!!el.closest('li')),false);await undo().click();assert.equal(await body().locator('li p').last().innerText(),'앞글🙂/글머리뒤글.');await redo().click();assert.equal(await synthetic().innerText(),source);
  await caret(synthetic(),4);await run('표');await body().locator('table').last().waitFor();assert((await body().innerText()).includes('앞글🙂'));assert((await body().innerText()).includes('뒤글.'));
  const cell=body().locator('table').last().locator('td p').first();await cell.click();await page.keyboard.insertText('셀앞셀뒤');await caret(cell,2);await run('AI');await page.getByRole('textbox',{name:'AI에게 질문'}).waitFor();assert((await page.locator('.note-ai-target').textContent()).includes('셀앞셀뒤'));await page.keyboard.press('Escape');await page.locator('.note-ai-popover').waitFor({state:'hidden'});assert.equal(await cell.innerText(),'셀앞셀뒤');
  // Revert the synthetic cell edits and block insertion without touching the earlier manuscript.
  await undo().click();await undo().click();await undo().click();await body().locator('table').waitFor({state:'hidden'});await clearQuery('표');
  await caret(synthetic(),4);await run('구분선');await body().locator('hr').waitFor();assert((await body().innerText()).includes('앞글🙂'));assert((await body().innerText()).includes('뒤글.'));await undo().click();await body().locator('hr').waitFor({state:'hidden'});await clearQuery('구분선');
  await caret(synthetic(),4);await run('AI');await page.getByRole('textbox',{name:'AI에게 질문'}).waitFor();assert((await page.locator('.note-ai-target').textContent()).includes(source));await page.keyboard.press('Escape');await page.getByRole('listbox',{name:menuLabel}).waitFor({state:'hidden'});assert.equal(await synthetic().innerText(),source);
  await caret(synthetic(),4);await page.keyboard.insertText('/');await page.getByRole('listbox',{name:menuLabel}).waitFor();await page.keyboard.press('Escape');await page.getByRole('listbox',{name:menuLabel}).waitFor({state:'hidden'});assert.equal(await synthetic().innerText(),'앞글🙂/뒤글.');await page.keyboard.press('Backspace');await page.getByRole('listbox',{name:menuLabel}).waitFor({state:'hidden'});
  // Numeric notation must remain text even when its denominator matches a heading command.
  const position=()=>body().evaluate(el=>el.editor.state.selection.from);

  for(const notation of ['1/2','2/3','2026/10/05','1 / 2','１/２']){
    await caret(synthetic(),source.length);await page.keyboard.type(' '+notation);await page.waitForTimeout(80);
    assert.equal(await page.getByRole('listbox',{name:menuLabel}).count(),0,notation);
    // Moving back into an existing fraction must not reopen the menu at an empty query.
    await caret(synthetic(),source.length+1+notation.indexOf('/')+1);await page.waitForTimeout(80);
    assert.equal(await page.getByRole('listbox',{name:menuLabel}).count(),0,`Caret inside ${notation}`);
    await caret(synthetic(),source.length+1+notation.length);const end=await position();await page.keyboard.press('ArrowUp');

    // Native arrows update the editor through the browser's asynchronous selectionchange event.
    for(let i=0;i<20&&await position()===end;i++)await page.waitForTimeout(20);
    assert.notEqual(await position(),end,`ArrowUp in ${notation}`);
    await caret(synthetic(),source.length+1+notation.length);const paragraphs=await body().locator('p').count();
    await page.keyboard.press('Enter');assert.equal(await body().locator('p').count(),paragraphs+1,`Enter after ${notation}`);
    assert.equal(await synthetic().innerText(),source+' '+notation);assert.equal(await body().locator('h2,h3').count(),0);
    await page.keyboard.press('Backspace');assert.equal(await body().locator('p').count(),paragraphs);

    for(let i=0;i<notation.length+1;i++)await page.keyboard.press('Backspace');assert.equal(await synthetic().innerText(),source);
  }

  // The numeric command shortcut still works outside numeric notation.
  await caret(synthetic(),4);await run('2');assert.equal(await body().locator('h2').innerText(),source);await undo().click();await clearQuery('2');
  await synthetic().click();await page.keyboard.press('End');await page.keyboard.insertText(' https://example.invalid/a/b');assert.equal(await page.getByRole('listbox',{name:menuLabel}).count(),0);
  // Regression: a prose slash with no matching command must not trap arrows.
  await page.keyboard.insertText(' 그/그녀');await page.waitForTimeout(80);assert.equal(await page.getByRole('listbox',{name:menuLabel}).count(),0);
  const end=await position();await page.keyboard.press('ArrowUp');assert.notEqual(await position(),end);await synthetic().click();await page.keyboard.press('End');

for(let i=0;i<5;i++)await page.keyboard.press('Backspace');
  await synced();await page.reload();await body().waitFor();assert.equal(await synthetic().innerText(),source+' https://example.invalid/a/b');
}
