import { useState, type FormEvent } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import "./landing-shared.css";

export function DemoModal({ returnFocus, light = false }: { returnFocus: () => void; light?: boolean }) {
  const [draft, setDraft] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const body = `Name: ${data.get("name")}\nEmail: ${data.get("email")}\nCompany: ${data.get("company")}\nERP / accounting system: ${data.get("system") || "To discuss"}`;
    window.location.href = `mailto:russell@classicvisions.net?subject=${encodeURIComponent("Warehouse Wizard demo request")}&body=${encodeURIComponent(body)}`;
    setDraft(true);
  };
  return <Dialog.Portal>
    <Dialog.Overlay className="ww-demo-backdrop" />
    <Dialog.Content className={`ww-demo ${light ? "ww-demo-light" : ""}`} aria-describedby="demo-description" onCloseAutoFocus={(event) => { event.preventDefault(); returnFocus(); }}>
      <Dialog.Close aria-label="Close demo request" className="ww-demo-close">×</Dialog.Close>
      <Dialog.Title>{draft ? "Your email draft is ready" : "Request a demo"}</Dialog.Title>
      {draft ? <p id="demo-description" role="status">Send the pre-filled message to request your demo. If your email app did not open, email <a href="mailto:russell@classicvisions.net">russell@classicvisions.net</a> directly.</p> : <>
        <Dialog.Description id="demo-description">Tell us about your operation. Review and send your request to russell@classicvisions.net in your email app.</Dialog.Description>
        <form onSubmit={submit}>
          <label htmlFor="demo-name">Full name<input id="demo-name" name="name" autoComplete="name" required maxLength={160} /></label>
          <label htmlFor="demo-email">Work email<input id="demo-email" name="email" type="email" autoComplete="email" spellCheck={false} required maxLength={254} /></label>
          <label htmlFor="demo-company">Company<input id="demo-company" name="company" autoComplete="organization" required maxLength={200} /></label>
          <label htmlFor="demo-system">ERP or accounting system <span>(optional)</span><input id="demo-system" name="system" autoComplete="off" maxLength={200} /></label>
          <p className="ww-demo-note">This opens an email draft. Your request is only sent when you send the email.</p>
          <button type="submit" className="ww-demo-submit">Prepare demo email</button>
        </form>
      </>}
    </Dialog.Content>
  </Dialog.Portal>;
}
