import { copy } from "@/content/copy";
import type { SceneKind } from "@/lib/thread";

/** The traffic light dots and a title, used by the little Mac windows. */
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

/** The Appearance window, shared by the Mac screen in the demo and the call video. */
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

function ListWindow({ scene }: { scene: "resume" | "due" }) {
  const data = copy.scenes[scene];
  return (
    <div className="fw">
      <TitleBar title={data.title} />
      <div className="fb">
        <ul className="side">
          {data.sidebar.map((name, index) => (
            <li key={name} className={index === 1 ? "on" : undefined}>
              {name}
            </li>
          ))}
        </ul>
        <ul className="list">
          {data.rows.map((name, index) => (
            <li key={name} className={index === data.selected ? "sel" : undefined}>
              <s />
              {name}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Window({ scene }: { scene: Exclude<SceneKind, "appearance"> }) {
  const { scenes } = copy;
  switch (scene) {
    case "resume":
    case "due":
      return <ListWindow scene={scene} />;
    case "folder":
      return (
        <div className="fw">
          <TitleBar title={scenes.folder.title} />
          <div className="fb grid">
            {scenes.folder.folders.map((name, index) => (
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
          <TitleBar title={scenes.text.title} />
          <div className="fb tx">
            <div className="aa">{scenes.text.sample}</div>
            <div className="sizer">
              <i />
            </div>
            <small>{scenes.text.label}</small>
          </div>
        </div>
      );
    case "mail":
      return (
        <div className="fw">
          <TitleBar title={scenes.mail.title} />
          <div className="fb mailb">
            <small>{scenes.mail.to}</small>
            <small>{scenes.mail.subject}</small>
            <p>{scenes.mail.body}</p>
            <div className="chip">{scenes.mail.file}</div>
          </div>
        </div>
      );
  }
}

/**
 * The Mac's screen as it appears in the call video: a bare desktop, with a
 * window that pops in for each scene. It is HTML and CSS, not an image.
 */
export function ScreenView({ scene, dark = false }: { scene: SceneKind | null; dark?: boolean }) {
  return (
    <div className={`appr${dark ? " dark" : ""}`} role="img" aria-label={copy.a11y.callScreen}>
      {scene === "appearance" ? (
        <AppearanceMock />
      ) : (
        <>
          <div className="menubar">
            <b />
            <span>{copy.call.desktop}</span>
          </div>
          {scene ? (
            <div className="vwin" key={scene}>
              <Window scene={scene} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
