import type { FC, ReactNode } from "react";

import type { LandingSectionContent } from "./landingContent";

interface LandingSectionProps {
  content: LandingSectionContent;
  cta?: ReactNode;
}

export const LandingSection: FC<LandingSectionProps> = ({ content, cta }) => {
  const HeadingTag = content.heading;

  return (
    <section className="landing-section">
      <div className="landing-section-inner">
        <div className="landing-copy">
          <p className="landing-kicker">{content.kicker}</p>
          <HeadingTag>{content.title}</HeadingTag>
          <p>{content.description}</p>
          {cta}
        </div>
      </div>
    </section>
  );
};
