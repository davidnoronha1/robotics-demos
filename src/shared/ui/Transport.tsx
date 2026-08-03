export interface TransportProps {
  playing: boolean;
  onPlay: () => void;
  onPause: () => void;
  onStep: () => void;
  onReset: () => void;
}

export function Transport({ playing, onPlay, onPause, onStep, onReset }: TransportProps) {
  return (
    <div class="ctrl ctrl-transport">
      <button type="button" onClick={() => (playing ? onPause() : onPlay())}>
        {playing ? "Pause" : "Play"}
      </button>
      <button type="button" onClick={onStep}>
        Step
      </button>
      <button type="button" onClick={onReset}>
        Reset
      </button>
    </div>
  );
}
