interface OpticalFlowBannerProps {
  banner: string;
  canCamera: boolean;
  onEnableCamera: () => void;
}

export function OpticalFlowBanner({ banner, canCamera, onEnableCamera }: OpticalFlowBannerProps) {
  return (
    <div class="imu-banner">
      <span>{banner}</span>
      {canCamera && (
        <button type="button" onClick={onEnableCamera}>
          Enable webcam
        </button>
      )}
    </div>
  );
}
