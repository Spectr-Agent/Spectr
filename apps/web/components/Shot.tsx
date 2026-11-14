import { copy } from "@/content/copy";
import type { ShotKind } from "@/lib/thread";

/** The traffic light dots and a title, used by the mini Finder windows. */
function TitleBar({ title }: { title?: string }) {
  return (
    <div className="tl">
      <i />
      <i />
      <i />
      {title ? <em>{title}</em> : null}
    </div>
  );
}

/** The Appearance window, shared by the Mac screen in the demo and the dark mode screenshot. */
export function AppearanceMock({ cursor = false }: { cursor?: boolean }) {
  const { mac } = copy.demo;
  return (
    <>
      <div className="menubar">
        <b />
        <span>{mac.app}</span>
      </div>
      <div className="awin">
        <TitleBar />
        <h6>{mac.pane}</h6>
        <div className="opts">
          <div className="opt light">
            <div className="th" />
            {mac.light}
          </div>
          <div className="opt dk">
            <div className="th" />
            {mac.dark}
          </div>
        </div>
      </div>
      {cursor ? (
        <svg className="cursor" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 2l16 9-7 2-3 7z" fill="#23262D" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      ) : null}
    </>
  );
}

/** The little screenshots Spectr sends back in a thread. Built with HTML and CSS, not images. */
export function Shot({ kind }: { kind: ShotKind }) {
  const { shots } = copy;
  switch (kind) {
    case "resume":
      return (
        <div className="fw">
          <TitleBar title={shots.resume.title} />
          <div className="fb">
            <ul className="side">
              {shots.resume.sidebar.map((name, index) => (
                <li key={name} className={index === 1 ? "on" : undefined}>
                  {name}
                </li>
              ))}
            </ul>
            <ul className="list">
              {shots.resume.files.map((name, index) => (
                <li key={name} className={index === 1 ? "sel" : undefined}>
                  <s />
                  {name}
                </li>
              ))}
            </ul>
          </div>
        </div>
      );
    case "folder":
      return (
        <div className="fw">
          <TitleBar title={shots.folder.title} />
          <div className="fb grid">
            {shots.folder.folders.map((name, index) => (
              <div key={name} className={`fo${index === 1 ? " sel" : ""}`}>
                <u />
                <span>{name}</span>
              </div>
            ))}
          </div>
        </div>
      );
    case "text":
      return (
        <div className="fw">
          <TitleBar title={shots.text.title} />
          <div className="fb tx">
            <div className="aa">{shots.text.sample}</div>
            <div className="slide">
              <i />
            </div>
            <small>{shots.text.label}</small>
          </div>
        </div>
      );
    case "dark":
      return (
        <div className="appr dark" style={{ fontSize: "6.5px", height: "112px", borderRadius: "14px" }}>
          <AppearanceMock />
        </div>
      );
  }
}
