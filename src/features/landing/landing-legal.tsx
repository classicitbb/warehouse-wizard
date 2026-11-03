import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import "./landing-v2.css";
import "./landing-legal.css";
import "./landing-shared.css";

type LegalDocument = { title: string; intro: string; sections: [string, string][]; review: string };
const DOCUMENTS: Record<string, LegalDocument> = {
  privacy: {
    title: "Privacy policy",
    intro: "This draft describes how Classic Visions, Barbados, intends to explain the handling of information in Warehouse Wizard. It is provided for review and is not a finalized privacy notice.",
    sections: [
      ["Who operates the service", "Warehouse Wizard is operated by Classic Visions in Barbados. For privacy questions, contact russell@classicvisions.net. A customer organization decides which business records and authorized users it brings into its workspace."],
      ["Information used by the service", "A workspace can contain user names and email addresses, assigned roles, warehouse and product records, inventory quantities and locations, movement records and audit history. Optional support, AI and integration features can process the information supplied to them. The exact data depends on the features your organization enables."],
      ["Why information is processed", "Information is used to provide access to the workspace, guide and record warehouse work, investigate exceptions, support users and operate configured integrations. Each organization's data-processing responsibilities and instructions should be documented in its service agreement."],
      ["Demo requests", "The demo form prepares an email using the details you enter. It does not submit those details to a lead database. Your email app and provider handle the message when you choose to send it to Classic Visions."],
      ["Hosting, integrations and AI", "The application uses cloud hosting and managed services for authentication and application data. Configured ERP and accounting integrations exchange the records needed for the agreed workflow. A connected MCP-compatible AI tool can receive inventory results allowed by the signed-in user's access. Review the relevant AI or integration provider's handling of those results before connecting it."],
      ["Browser storage and analytics", "The application uses browser storage for functions such as sessions, device identity and offline behavior. Vercel Analytics is included in the application. The production deployment's analytics behavior, any additional tracking, and any required consent must be confirmed before this notice is finalized."],
      ["Access, retention and requests", "Access is controlled through authenticated accounts, assigned roles and data-access rules. Contact your organization's administrator or russell@classicvisions.net about access, correction, export or deletion requests. Specific retention periods, backup deletion, processing locations and the applicable request process must be set out in the final notice and service agreement."],
      ["Changes and local requirements", "A final notice should identify its effective date and explain how material changes are communicated. Applicable privacy requirements in the jurisdictions where the service is used must be addressed before release."],
    ],
    review: "Confirm the complete operator contact details, controller/processor roles, hosting and processing regions, subprocessors, retention schedule, rights procedure, international-transfer terms and actual analytics/consent configuration before publication.",
  },
  terms: {
    title: "Terms and conditions",
    intro: "These proposed service terms are a review draft for Classic Visions, Barbados. They do not create a subscription or replace a signed customer agreement.",
    sections: [
      ["Service and scope", "Warehouse Wizard supports warehouse execution and inventory visibility. The subscription, permitted users, enabled modules, implementation work and supported integrations should be described in an agreed order or service agreement with Classic Visions."],
      ["Authorized use", "Customers are responsible for authorizing users, assigning appropriate roles, protecting credentials and using the service lawfully. Users must not attempt to access another organization's records, bypass access controls or interfere with the service."],
      ["Inventory decisions and responsibilities", "The service guides and records warehouse work. Accurate records also depend on correct setup, scanning, counts, user actions and reconciliation. Customers remain responsible for checking stock and reviewing exceptions before making purchasing, fulfilment or financial decisions."],
      ["Integrations and AI", "Each ERP or accounting connection requires an agreed scope, access permissions, mapping and testing. Third-party availability and API capabilities may affect the connection. AI outputs require review, and connecting an external assistant may share authorized query results with that provider."],
      ["Cloud service and changes", "Software and configuration may evolve over time. Deployment arrangements, maintenance windows, support commitments, backup and recovery commitments, and any service levels must be agreed with the customer. This draft makes no uptime or response-time guarantee."],
      ["Fees, cancellation and data return", "Prices, payment terms, renewal, termination, suspension grounds, export assistance and post-termination data handling belong in the signed commercial agreement. No price or billing commitment is created by visiting the landing page or requesting a demo."],
      ["Ownership and confidentiality", "The proposed arrangement preserves the customer's rights in its business data and the software owner's rights in Warehouse Wizard, subject to any applicable third-party licences. Final terms should define confidentiality, permitted processing and each party's responsibilities."],
      ["Applicable law and disputes", "The intended approach is to respect applicable law in the jurisdiction where the customer uses the software, including any mandatory local protections. The governing law and dispute forum for each customer must be expressly agreed in its contract; a location of use alone does not settle cross-border conflicts."],
      ["Questions", "Contact russell@classicvisions.net to discuss scope, implementation or the final agreement before subscribing."],
    ],
    review: "Legal review is required for enforceable acceptance, governing law and forum for each market, liability, warranties, indemnities, suspension, termination, payment and customer data obligations. No click-to-accept flow is enabled.",
  },
  licence: {
    title: "End user licence agreement",
    intro: "This proposed licence describes an intended authorized-use arrangement for Warehouse Wizard from Classic Visions, Barbados. It is a draft for review, not a licence accepted by browsing this page.",
    sections: [
      ["Proposed licence", "Subject to a signed agreement, authorized users would receive a limited, non-exclusive right to access the hosted software for their organization's agreed warehouse operations during the subscription term. User counts, locations, modules and any other scope limits must be agreed in writing."],
      ["Accounts and access", "Use is restricted to accounts authorized by the customer and the service operator. Users must keep credentials secure and follow their organization's assigned permissions. The licence does not itself grant administrative access or a right to another organization's data."],
      ["Permitted configuration and connections", "Authorized configuration of stock, locations, capacity and workflow settings is part of normal use. API and MCP access must use approved credentials and remain within the agreed scope, permissions and third-party terms. Custom development and connector deliverables require an agreed statement of work."],
      ["Software rights", "A subscription provides access to the service rather than a transfer of ownership in the software. Third-party components retain their respective licences. Final terms must identify the licensor's rights and any customer-specific ownership arrangements."],
      ["Use restrictions", "The proposed licence prohibits unauthorized resale, credential sharing, deliberate interference and attempts to bypass access restrictions. Any restriction on copying, reverse engineering or similar activity must remain subject to rights that applicable law does not allow a contract to exclude."],
      ["Updates and continued use", "The hosted application may receive updates. Any support, compatibility, notice or change-management commitments should be stated in the service agreement. Customers should review configuration and integration changes before relying on them in operations."],
      ["End of access", "Expiry, termination, suspension, data export and deletion arrangements must be defined in the signed agreement. This draft does not set an automatic forfeiture, deletion deadline or termination penalty."],
      ["Local law and final agreement", "The final agreement should specify governing law and dispute arrangements for the customer's place of use while preserving applicable mandatory local rights. Warranty, liability and remedy terms require review for the relevant jurisdiction."],
    ],
    review: "Confirm the legal licensor, intellectual-property rights, licence scope, acceptance process and any warranty/liability provisions with counsel before release. This draft is not presented as an executed or accepted agreement.",
  },
};

export default function LandingLegal() {
  const { document = "privacy" } = useParams();
  const content = DOCUMENTS[document];
  useEffect(() => { window.scrollTo(0, 0); }, [document]);
  return <div className="ww-v2 ww-legal" id="legal-top">
    <header className="v2-header"><div className="v2-header-inner"><Link className="v2-brand" to="/landing-v2"><img src="/logo-mark.svg" width="30" height="30" alt="" />Warehouse Wizard</Link><Link to="/landing-v2" className="v2-text-link"><ArrowLeft size={16} aria-hidden="true" />Back to landing V2</Link></div></header>
    <main className="v2-wrap ww-legal-main">
      {content ? <><p className="ww-legal-status">Draft for review · Prepared 2 November 2026 · Not yet effective</p><h1>{content.title}</h1><p className="ww-legal-intro">{content.intro}</p><nav aria-label="Legal documents"><Link to="/legal/privacy" aria-current={document==='privacy'?'page':undefined}>Privacy policy</Link><Link to="/legal/terms" aria-current={document==='terms'?'page':undefined}>Terms and conditions</Link><Link to="/legal/licence" aria-current={document==='licence'?'page':undefined}>End user licence agreement</Link></nav>{content.sections.map(([title,text])=><section key={title}><h2>{title}</h2><p>{text}</p></section>)}<aside><h2>Before this draft becomes effective</h2><p>{content.review}</p></aside></> : <><h1>Document not found</h1><p>Choose a legal document from the <Link to="/landing-v2">landing page</Link>.</p></>}
      <div className="ww-legal-return"><Link to="/landing-v2">← Back to landing V2</Link><Link to="/landing">Original landing page</Link><a href="#legal-top">Back to top ↑</a></div>
    </main><a className="ww-back-top" href="#legal-top">↑ Back to top</a>
  </div>;
}
