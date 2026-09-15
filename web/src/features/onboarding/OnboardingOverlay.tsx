import type { FC } from "react";

interface OnboardingOverlayProps {
  open: boolean;
  onClose: () => void;
}

export const OnboardingOverlay: FC<OnboardingOverlayProps> = ({ open, onClose }) => {
  if (!open) {
    return null;
  }

  return (
    <div className="onboarding-overlay" role="dialog" aria-modal="true">
      <div className="onboarding-card">
        <h2>How to Use Speed Reader</h2>
        <ol>
          <li>Upload a PDF or EPUB.</li>
          <li>Press Play or Space to start RSVP mode.</li>
          <li>Adjust speed, context range, and opacity in controls.</li>
          <li>Use arrow keys to move or change speed.</li>
        </ol>
        <button type="button" onClick={onClose}>
          Continue
        </button>
      </div>
    </div>
  );
};
