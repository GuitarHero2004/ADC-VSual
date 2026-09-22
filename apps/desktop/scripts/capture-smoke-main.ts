import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  protocol,
  nativeImage,
  desktopCapturer,
} from 'electron';
import { createDesktopHost } from '../src/host.ts';
import { readForegroundWindow } from '../src/foreground.ts';
import { DESKTOP_SHORTCUTS } from '../src/bridge.ts';

// Real Windows pixels, synthetic window only. Auth and the provider are mocked.
const profile = process.env.VSUAL_SMOKE_PROFILE;
if (!profile) throw new Error('Use the capture smoke script.');
const interactive = process.argv.includes('--interactive');
app.setPath('userData', profile);
app.setName('VSual Capture Check');
protocol.registerSchemesAsPrivileged([
  { scheme: 'vsual', privileges: { standard: true, secure: true } },
]);
process.env.VSUAL_API_BASE_URL = 'https://api.example.test';
process.env.VSUAL_SUPABASE_URL = 'https://auth.example.test';
process.env.VSUAL_SUPABASE_PUBLISHABLE_KEY = `sb_publishable_${crypto.randomUUID().replaceAll('-', '')}`;
delete process.env.VSUAL_WORKSPACE_ID;
const user = {
  id: crypto.randomUUID(),
  email: 'reader@example.test',
  aud: 'authenticated',
  created_at: new Date().toISOString(),
  app_metadata: {},
  user_metadata: {},
};
let host: Awaited<ReturnType<typeof createDesktopHost>> | undefined;
let fixture: BrowserWindow | undefined;
const timer = setTimeout(
  () => {
    console.error('Synthetic capture check timed out.');
    host?.dispose();
    fixture?.destroy();
    app.exit(1);
  },
  interactive ? 165_000 : 40_000,
);
app.on('window-all-closed', () => {});
void app.whenReady().then(async () => {
  let providerCalls = 0;
  let speechCalls = 0;
  let transcribeCalls = 0;
  let recordedBytes = 0;
  let previousRequestId: string | undefined;
  const followUpQuestion = 'Describe the positions of the colored shapes.';
  try {
    fixture = new BrowserWindow({
      width: 760,
      height: 520,
      show: false,
      title: 'VSual synthetic capture fixture',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    await fixture.loadURL(
      `data:text/html,${encodeURIComponent('<!doctype html><html><head><title>VSual synthetic capture fixture</title></head><body style="margin:0;background:white;font:32px Arial"><h1>SYNTHETIC SCREEN CHECK</h1><p>Red square beside a blue rectangle</p><div style="display:flex;gap:20px;padding:20px"><div style="width:220px;height:220px;background:rgb(230,20,20)"></div><div style="width:380px;height:220px;background:rgb(20,20,230)"></div></div><p>No personal content</p></body></html>')}`,
    );
    fixture.show();
    fixture.showInactive(); // STARTUPINFO may hide the first ShowWindow in a hidden test process.
    const enumerated = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 0, height: 0 },
    });
    console.log(
      JSON.stringify({
        check: 'synthetic_window_enumeration',
        fixtureVisible: fixture.isVisible(),
        fixturePresent: enumerated.some(
          (source) => source.name === 'VSual synthetic capture fixture',
        ),
      }),
    );
    const transport: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === '/auth/v1/token')
        return Response.json({
          access_token: crypto.randomUUID(),
          refresh_token: crypto.randomUUID(),
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          token_type: 'bearer',
          user,
        });
      if (url.pathname === '/auth/v1/user') return Response.json(user);
      if (url.pathname === '/api/auth/access')
        return Response.json({
          request_id: crypto.randomUUID(),
          account: { id: user.id, email: user.email },
          workspace: 'allowed',
        });
      if (url.pathname === '/api/voice/transcribe') {
        transcribeCalls++;
        assert.ok(
          init?.body instanceof FormData,
          'Recorded audio uses multipart upload',
        );
        const audio = init.body.get('audio');
        assert.ok(
          audio instanceof Blob && audio.size > 0,
          'Native MediaRecorder produced nonempty audio',
        );
        assert.ok(
          audio.type.startsWith('audio/webm'),
          'Recorded media retains the Chromium audio MIME type',
        );
        recordedBytes += audio.size;
        return Response.json({
          request_id: new Headers(init.headers).get('X-Request-ID'),
          transcript: 'Option one.',
          detected_language: 'en',
        });
      }
      if (url.pathname === '/api/voice/speak') {
        speechCalls++;
        const speech = JSON.parse(String(init?.body));
        assert.ok(
          speech.text.includes(followUpQuestion),
          'The answer and its follow-up choice use one speech request',
        );
        // Exercise recoverable voice failure without producing sound or spending credits.
        return Response.json(
          {
            request_id: crypto.randomUUID(),
            error: {
              code: 'RATE_LIMITED',
              message: 'Synthetic voice quota check.',
            },
          },
          { status: 429 },
        );
      }
      if (url.pathname === '/api/desktop-read') {
        providerCalls++;
        const body = JSON.parse(String(init?.body));
        if (providerCalls === 1) {
          assert.equal(body.follow_up_context, undefined);
        } else if (providerCalls === 2) {
          assert.equal(body.question, followUpQuestion);
          assert.equal(body.follow_up_context?.request_id, previousRequestId);
          assert.equal(
            body.follow_up_context?.source_id,
            body.snapshot.source_id,
          );
          assert.equal(
            body.follow_up_context?.answer,
            'Synthetic test response; no live model was called.',
          );
        } else {
          assert.equal(
            body.follow_up_context,
            undefined,
            'Ask something else starts without the prior exchange',
          );
        }
        previousRequestId = body.request_id;
        const bytes = Buffer.from(body.images[0].base64, 'base64');
        const image = nativeImage.createFromBuffer(bytes);
        const bitmap = image.toBitmap();
        let red = 0,
          blue = 0;
        for (let index = 0; index < bitmap.length; index += 4) {
          if (bitmap[index + 2]! > 180 && bitmap[index]! < 75) red++;
          if (bitmap[index]! > 180 && bitmap[index + 2]! < 75) blue++;
        }
        assert.ok(
          red > 1000 && blue > 1000,
          'Actual submitted image must contain both synthetic colored shapes',
        );
        assert.ok(
          blue > red,
          'Selected window shape proportions remain meaningful',
        );
        await writeFile(join(__dirname, 'capture-smoke.jpg'), bytes);
        return Response.json({
          source_kind: 'desktop_window',
          request_id: body.request_id,
          snapshot_id: body.snapshot.snapshot_id,
          source_id: body.snapshot.source_id,
          fingerprint: body.snapshot.fingerprint,
          captured_at: body.snapshot.captured_at,
          status: 'answer',
          answer_language: 'en',
          text: 'Synthetic test response; no live model was called.',
          follow_ups: [{ question: followUpQuestion, evidence_indices: [1] }],
          evidence: [
            {
              image_id: 'image-1',
              region: { x: 0.05, y: 0.3, width: 0.8, height: 0.4 },
              description: 'Synthetic colored shapes.',
            },
          ],
        });
      }
      throw new Error('Unexpected synthetic transport request');
    };
    host = await createDesktopHost({
      directory: __dirname,
      userData: profile,
      quit: () => app.quit(),
      transport,
    });
    const contents = host.window.webContents;
    host.show();
    host.hide();
    fixture.show();
    if (interactive) {
      let settings = host.settings.snapshot();
      if (!settings.shortcutRegistered) {
        for (const shortcut of DESKTOP_SHORTCUTS) {
          if (shortcut === settings.preferences.shortcut) continue;
          settings = await host.settings.update({ language: 'en', shortcut });
          if (settings.shortcutRegistered) break;
        }
      }
      assert.equal(
        settings.shortcutRegistered,
        true,
        'No supported Talk shortcut is available for this temporary test profile',
      );
      console.log(
        JSON.stringify({
          check: 'ready_for_activation',
          fixtureTitle: 'VSual synthetic capture fixture',
          shortcut: settings.preferences.shortcut,
          timeoutSeconds: 120,
          instruction:
            'Activate the synthetic fixture, then press the registered shortcut.',
        }),
      );
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline && !host.window.isVisible()) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(
        host.window.isVisible(),
        true,
        'The shortcut did not open VSual within 120 seconds',
      );
    } else {
      fixture.moveTop();
      fixture.focus();
      await fixture.webContents.executeJavaScript(
        'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',
      );
      const foreground = await readForegroundWindow();
      assert.equal(
        foreground?.split(':')[1],
        fixture.getMediaSourceId().split(':')[1],
        'Windows did not activate the synthetic fixture. Run test:capture -- --interactive to activate it with the keyboard.',
      );
      await Promise.all([host.activate(), host.activate()]);
    }
    // Activation precedes first sign-in: authentication must retain the selected
    // native window while clearing any prior account's sensitive task state.
    const signedIn = await contents.executeJavaScript(`(async()=>{
      const tick=()=>new Promise(resolve=>setTimeout(resolve,25));
      const wait=async(condition)=>{const start=Date.now();while(!condition()){if(Date.now()-start>15000)throw new Error('Sign-in UI timed out');await tick();}return condition();};
      const fill=(element,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));};
      await wait(()=>document.querySelector('input[name=email]'));
      fill(document.querySelector('input[name=email]'),'reader@example.test');
      fill(document.querySelector('input[name=password]'),crypto.randomUUID());
      await tick();
      document.querySelector('input[name=email]').form.requestSubmit();
      await wait(()=>document.querySelector('#desktop-question'));
      return !document.querySelector('#desktop-source');
    })()`);
    assert.equal(
      signedIn,
      true,
      'Automatic-target journey has no window dropdown',
    );
    const activeSource = await contents.executeJavaScript(
      'window.vsualDesktop.getActiveSource()',
    );
    assert.ok(
      activeSource?.title === 'VSual synthetic capture fixture',
      'The selected synthetic fixture must survive first sign-in',
    );
    assert.equal(
      providerCalls,
      0,
      'Automatic targeting never submits or captures',
    );
    assert.equal(
      speechCalls,
      0,
      'Opening and targeting never generates answer speech',
    );
    const outcome = await contents.executeJavaScript(`(async()=>{
      const tick=()=>new Promise(resolve=>setTimeout(resolve,25));
      const wait=async(condition)=>{const start=Date.now();while(!condition()){if(Date.now()-start>15000)throw new Error('Answer UI timed out');await tick();}return condition();};
      const button=(text)=>[...document.querySelectorAll('button')].find(element=>element.textContent.trim()===text);
      await wait(()=>document.querySelector('.desktop-current-source')?.textContent.includes('VSual synthetic capture fixture'));
      const field=document.querySelector('#desktop-question');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'Describe the synthetic colored shapes.');
      field.dispatchEvent(new Event('input',{bubbles:true}));
      const ask=await wait(()=>{const control=button('Ask VSual');return control&&!control.disabled?control:null;});
      ask.click();
      await wait(()=>document.querySelector('.answer-text'));
      await wait(()=>button('Retry answer audio'));
      return {answer:document.querySelector('.answer-text').textContent,evidence:document.querySelectorAll('.desktop-evidence li').length,voiceToggle:!!document.querySelector('.desktop-voice-settings input[type=checkbox]')};
    })()`); // No manufactured gesture: silence-triggered capture must also work.
    assert.equal(
      outcome.answer,
      'Synthetic test response; no live model was called.',
    );
    assert.equal(outcome.evidence, 1);
    assert.equal(outcome.voiceToggle, false);
    assert.equal(providerCalls, 1);
    assert.equal(
      speechCalls,
      1,
      'Each accepted answer automatically attempts speech once',
    );
    // Replace only the microphone device in this isolated synthetic renderer.
    // Native MediaRecorder, preload IPC, React and main auth/request ownership stay real.
    await contents.executeJavaScript(
      `(async()=>{
      const context=new AudioContext();
      await context.resume();
      window.__captureVoiceCheck={context,streams:[],generators:[],requests:0};
      Object.defineProperty(navigator.mediaDevices,'getUserMedia',{
        configurable:true,
        value:async(constraints)=>{
          if(constraints.video || !constraints.audio)throw new Error('Unexpected synthetic microphone constraints');
          const destination=context.createMediaStreamDestination();
          const silence=context.createConstantSource();
          silence.offset.value=0;
          silence.connect(destination);
          silence.start();
          window.__captureVoiceCheck.generators.push(silence);
          window.__captureVoiceCheck.requests++;
          window.__captureVoiceCheck.streams.push(destination.stream);
          return destination.stream;
        }
      });
    })()`,
      true,
    );
    host.window.focus();
    const voiceForeground = await readForegroundWindow();
    assert.ok(
      [host.window.getMediaSourceId(), fixture.getMediaSourceId()].some(
        (source) => source.split(':')[1] === voiceForeground?.split(':')[1],
      ),
      'Windows focus changed outside the synthetic fixture; no microphone activation was attempted',
    );
    await Promise.all([host.activate('talk'), host.activate('talk')]);
    const afterTalkSource = await contents.executeJavaScript(
      'window.vsualDesktop.getActiveSource()',
    );
    assert.equal(
      afterTalkSource?.title,
      'VSual synthetic capture fixture',
      'Talk from VSual preserves the selected external window',
    );
    const firstRecording = await contents.executeJavaScript(`(async()=>{
      const end=Date.now()+5000;
      while(![...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Stop and review')){
        if(Date.now()>end)throw new Error('Talk did not start synthetic recording: '+JSON.stringify({requests:window.__captureVoiceCheck.requests,status:[...document.querySelectorAll('[role=status]')].map(element=>element.textContent),controls:[...document.querySelectorAll('button')].map(element=>element.textContent.trim())}));
        await new Promise(resolve=>setTimeout(resolve,25));
      }
      return window.__captureVoiceCheck.requests;
    })()`);
    assert.equal(
      firstRecording,
      1,
      'Duplicate native Talk delivers one microphone request',
    );
    await contents.executeJavaScript('window.vsualDesktop.stopWork()');
    const cancelledRecording = await contents.executeJavaScript(`(async()=>{
      const end=Date.now()+5000;
      while(window.__captureVoiceCheck.streams.some(stream=>stream.getTracks().some(track=>track.readyState!=='ended'))){
        if(Date.now()>end)throw new Error('Stop did not release synthetic microphone tracks');
        await new Promise(resolve=>setTimeout(resolve,25));
      }
      return window.__captureVoiceCheck.streams.length;
    })()`);
    assert.equal(cancelledRecording, 1);
    assert.equal(
      transcribeCalls,
      0,
      'Stop discards recording without transcription',
    );
    assert.equal(
      providerCalls,
      1,
      'Starting and cancelling recording do not ask the model',
    );

    await host.activate('talk');
    await contents.executeJavaScript(`(async()=>{
      const end=Date.now()+5000;
      while(![...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Stop and review')){
        if(Date.now()>end)throw new Error('Second Talk did not record');
        await new Promise(resolve=>setTimeout(resolve,25));
      }
      await new Promise(resolve=>setTimeout(resolve,400));
    })()`);
    await host.activate('talk'); // Recording toggle is Stop and review, never auto-submit.
    const reviewed = await contents.executeJavaScript(`(async()=>{
      const end=Date.now()+5000;
      const field=()=>document.querySelector('#desktop-question');
      while(!field() || field().readOnly || field().value!=='Option one.'){
        if(Date.now()>end)throw new Error('Recorded transcript did not become editable: '+JSON.stringify({requests:window.__captureVoiceCheck.requests,status:[...document.querySelectorAll('[role=status]')].map(element=>element.textContent)}));
        await new Promise(resolve=>setTimeout(resolve,25));
      }
      return {
        microphoneRequests:window.__captureVoiceCheck.requests,
        tracksEnded:window.__captureVoiceCheck.streams.every(stream=>stream.getTracks().every(track=>track.readyState==='ended')),
      };
    })()`);
    assert.equal(reviewed.microphoneRequests, 2);
    assert.equal(reviewed.tracksEnded, true);
    assert.equal(
      transcribeCalls,
      1,
      'Finish uploads once, including the final recorder chunk',
    );
    assert.ok(recordedBytes > 0);
    assert.equal(
      providerCalls,
      1,
      'Stop and review preserves explicit question submission',
    );
    const followup = await contents.executeJavaScript(`(async()=>{
      const button=[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Ask VSual');
      if(!button || button.disabled)throw new Error('Reviewed question is not ready to submit');
      button.click();
      const end=Date.now()+10000;
      while(!document.querySelector('.answer-text') || ![...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Retry answer audio')){
        if(Date.now()>end)throw new Error('Reviewed voice question did not receive its synthetic answer');
        await new Promise(resolve=>setTimeout(resolve,25));
      }
      window.__captureVoiceCheck.generators.forEach(generator=>generator.stop());
      await window.__captureVoiceCheck.context.close();
      return document.querySelector('.answer-text').textContent;
    })()`);
    assert.equal(
      followup,
      'Synthetic test response; no live model was called.',
    );
    assert.equal(
      providerCalls,
      2,
      'One model request per explicitly submitted question',
    );
    assert.equal(speechCalls, 2, 'One audio attempt per accepted answer');
    const newTopic = await contents.executeJavaScript(`(async()=>{
      const button=(label)=>[...document.querySelectorAll('button')].find(button=>button.textContent.trim()===label);
      const other=button('Ask something else');
      if(!other)throw new Error('New-question control is missing');
      other.click();
      await new Promise(resolve=>setTimeout(resolve,25));
      const field=document.querySelector('#desktop-question');
      if(field.value || document.activeElement!==field)throw new Error('New-question control must clear and focus the draft');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'Describe the visible shapes again.');
      field.dispatchEvent(new Event('input',{bubbles:true}));
      await new Promise(resolve=>setTimeout(resolve,25));
      button('Ask VSual').click();
      const end=Date.now()+10000;
      while(!document.querySelector('.answer-text') || !button('Retry answer audio')){
        if(Date.now()>end)throw new Error('New-question request did not finish');
        await new Promise(resolve=>setTimeout(resolve,25));
      }
      return document.querySelectorAll('.desktop-evidence li').length;
    })()`);
    assert.equal(newTopic, 1);
    assert.equal(providerCalls, 3);
    assert.equal(speechCalls, 3);
    host.dispose();
    fixture.destroy();
    clearTimeout(timer);
    console.log(
      JSON.stringify({
        check: 'desktop_selected_window_capture',
        result: 'passed',
        nativeCapture: true,
        actualSubmittedPixels: true,
        rendererJourney: true,
        foregroundSelection: true,
        firstSignInPreservesTarget: true,
        automaticSpeechRequest: true,
        voiceFailurePreservesAnswer: true,
        talkActivationViaPreload: true,
        duplicateTalkDeduplicated: true,
        stopReleasesRecording: true,
        stopAndReviewUploadsOnce: true,
        nativeMediaRecorder: true,
        spokenFollowUpChoice: true,
        priorExchangeBoundToSource: true,
        newTopicClearsContext: true,
        microphoneDevice: 'synthetic_audio_stream_no_hardware',
        transcription: 'mocked',
        recordedBytes,
        auth: 'mocked',
        provider: 'mocked',
        activation: interactive ? 'registered_shortcut' : 'host_method',
        physicalKeyboard: interactive ? 'external_input_required' : 'not_run',
        nvda: 'not_run',
      }),
    );
    app.exit(0);
  } catch (error) {
    console.error(
      'Synthetic capture check failed:',
      error instanceof Error ? error.message : 'Unknown',
    );
    host?.dispose();
    fixture?.destroy();
    clearTimeout(timer);
    app.exit(1);
  }
});
