interface ImuBannerProps {
  bannerText: string;
  isRealSupported: boolean;
  usingReal: boolean;
  enableDisabled: boolean;
  onEnableSensors: () => void;
}

export function ImuBanner({
  bannerText,
  isRealSupported,
  usingReal,
  enableDisabled,
  onEnableSensors,
}: ImuBannerProps) {
  return (
    <div class="imu-banner">
      <span>{bannerText}</span>
      {isRealSupported && !usingReal && (
        <button
          type="button"
          class="imu-enable"
          disabled={enableDisabled}
          onClick={onEnableSensors}
        >
          Enable motion sensors
        </button>
      )}
    </div>
  );
}
