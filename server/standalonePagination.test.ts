import {expect,it,vi} from 'vitest';
import {completeStandaloneInventory} from './standaloneFlowAgentBuild.ts';
// Exact upstream pagination algorithm shape, isolated from provider/auth code.
const source=`async function followPagination(fetchPage, maxPages = DEFAULT_MAX_PAGES, stopWhen, onLimitReached) {
  const allItems = [];
  let response = await fetchPage();
  allItems.push(...response.value);
  let page = 1;
  while (response.nextLink && page < maxPages && !stopWhen?.(allItems)) {
    response = await fetchPage(response.nextLink);
    allItems.push(...response.value);
    page++;
  }
  if (response.nextLink && page >= maxPages) onLimitReached?.(response.nextLink);
  return allItems;
}
`;
const execute=()=>Function('DEFAULT_MAX_PAGES',completeStandaloneInventory(source)+';return followPagination;')(5);
it('refuses five capped sparse pages even when fewer than fifty rows were returned',async()=>{const fetch=vi.fn(async()=>({value:[{name:'synthetic'}],nextLink:'more'}));await expect(execute()(fetch)).rejects.toThrow('coverage incomplete');expect(fetch).toHaveBeenCalledTimes(5);});
it('refuses a caller stop with unresolved continuation rather than claiming inventory absence',async()=>{const fetch=vi.fn(async()=>({value:[],nextLink:'more'}));await expect(execute()(fetch,5,()=>true)).rejects.toThrow('coverage incomplete');expect(fetch).toHaveBeenCalledOnce();});
it('returns only a fully exhausted inventory without increasing the existing five-page cap',async()=>{const fetch=vi.fn().mockResolvedValueOnce({value:[{name:'one'}],nextLink:'next'}).mockResolvedValueOnce({value:[{name:'two'}]});expect(await execute()(fetch)).toEqual([{name:'one'},{name:'two'}]);expect(fetch).toHaveBeenCalledTimes(2);});
it.each([source+source,source.replace('followPagination(','changed('),source.replace('  return allItems;','  return [];'),source.replace(/\n\}\n/,'\n }\n')])('refuses pagination structural drift',text=>expect(()=>completeStandaloneInventory(text)).toThrow());
