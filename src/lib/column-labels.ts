/**
 * Shortens long table column headings so operational tables stay narrow.
 * Headings longer than 9 characters are abbreviated; the full label is kept
 * for a tooltip.
 */
const WORD_MAP: Record<string, string> = {
  account: "Acct",
  address: "Addr",
  adjustment: "Adj",
  adjustments: "Adjs",
  allocated: "Alloc",
  appointment: "Appt",
  assigned: "Asgn",
  authorization: "Auth",
  available: "Avail",
  barcode: "Code",
  capacity: "Cap",
  category: "Cat",
  completed: "Compl",
  confirmed: "Conf",
  container: "Cntr",
  customer: "Cust",
  damaged: "Dmgd",
  department: "Dept",
  description: "Desc",
  destination: "Dest",
  difference: "Diff",
  dimensions: "Dims",
  direction: "Dir",
  document: "Doc",
  duration: "Dur",
  estimated: "Est",
  expected: "Exp",
  expiration: "Exp",
  frequency: "Freq",
  identifier: "ID",
  integration: "Integ",
  inventory: "Inv",
  location: "Loc",
  manager: "Mgr",
  maximum: "Max",
  message: "Msg",
  minimum: "Min",
  movement: "Move",
  number: "No.",
  operator: "Oper",
  original: "Orig",
  package: "Pkg",
  packaging: "Pkg",
  percent: "Pct",
  percentage: "Pct",
  priority: "Prio",
  product: "Prod",
  quantity: "Qty",
  received: "Rcvd",
  recommended: "Recmd",
  reference: "Ref",
  registered: "Reg",
  requested: "Reqd",
  required: "Reqd",
  requirement: "Req",
  reserved: "Resv",
  rotation: "Rot",
  scheduled: "Sched",
  sequence: "Seq",
  severity: "Sev",
  supplier: "Suppl",
  temperature: "Temp",
  timestamp: "Time",
  transfer: "Xfer",
  utilization: "Util",
  variance: "Var",
  warehouse: "WH",
};

const MAX_LABEL_LENGTH = 9;

function shortenWord(word: string) {
  const bare = word.replace(/[^A-Za-z]/g, "").toLowerCase();
  const mapped = WORD_MAP[bare];
  if (!mapped) return word;
  return word.replace(/[A-Za-z]+/, mapped);
}

export function abbreviateColumnLabel(label: string): string {
  const trimmed = label.trim();
  if (trimmed.length <= MAX_LABEL_LENGTH) return trimmed;

  const shortened = trimmed.split(/\s+/).map(shortenWord).join(" ");
  if (shortened.length <= MAX_LABEL_LENGTH) return shortened;

  const shortWords = shortened.split(/\s+/);
  if (shortWords.length > 1) {
    const initials = shortWords
      .map((word) => word.replace(/[^A-Za-z0-9]/g, "").slice(0, 1).toUpperCase())
      .join("");
    if (initials.length >= 2) return initials;
  }

  return `${shortened.slice(0, MAX_LABEL_LENGTH - 1)}\u2026`;
}
