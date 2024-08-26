// eslint-disable-next-line header/header
export const SynthesizerUrl = 'http://localhost';
// export const SynthesizerUrl = 'http://shays-MacBook-Pro.local';
export const SynthesizerPort = 5000;
export const SythesisRequestRoute = 'synt_with_state';
export const SythesizerCleanRequestRoute = 'clear_state';
export const SynthesisTimeoutInMiliSeconds = 15000;  //15 seconds
export const RestartSynthesisTimeoutInMiliSeconds = 3000;  //3 seconds
export const doesTrigger = process.env.DOESTRIGGER === 'false';  //run synthersizer in the background always or by user request [true = then triggered, false = triggerless]
export const minimumUniqueExamples4Triggerless = 3;

// Design Parameters
export const triggerlessExtraBreakpoint = false;
export const suggestedValueAsComment = false;
export const sketchValueInline = true;
