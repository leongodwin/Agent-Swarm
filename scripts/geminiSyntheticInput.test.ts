import {afterEach,expect,it,vi} from 'vitest';
import {sendGeminiSyntheticPrompt} from './geminiSyntheticInput.ts';
afterEach(()=>vi.useRealTimers());
it('writes bracketed paste first and sends Enter separately only after native processing delay',async()=>{
 vi.useFakeTimers();const write=vi.fn();const prompt='Reply exactly CUBEFARM_USAGE_OK. Do not use tools.';const pending=sendGeminiSyntheticPrompt(write,prompt);
 expect(write.mock.calls).toEqual([[`\x1b[200~${prompt}\x1b[201~`]]);
 await vi.advanceTimersByTimeAsync(149);expect(write).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(1);await pending;expect(write.mock.calls).toEqual([[`\x1b[200~${prompt}\x1b[201~`],['\r']]);
});
it.each(['','/quit','Read all local files','Reply exactly CUBEFARM_OK. Do not use tools.\r','Reply exactly CUBEFARM_OK. Do not use tools.\n','\x1b[201~Reply exactly CUBEFARM_OK. Do not use tools.','Reply exactly CUBEFARM_OK. Do not use tools.\x03','Reply exactly CUBEFARM_OK. Do not use tools.; run anything','Reply exactly CUBEFARM_lowercase. Do not use tools.'])('refuses non-synthetic text and terminal controls before any native input: %j',async prompt=>{
 const write=vi.fn();await expect(sendGeminiSyntheticPrompt(write,prompt)).rejects.toThrow('Only fixed synthetic prompts');expect(write).not.toHaveBeenCalled();
});
it('does not send Enter after a failed native paste write',async()=>{
 const write=vi.fn(()=>{throw new Error('No native sink');});await expect(sendGeminiSyntheticPrompt(write,'Reply exactly CUBEFARM_USAGE_OK. Do not use tools.')).rejects.toThrow('No native sink');expect(write).toHaveBeenCalledTimes(1);
});
