export interface Position {
  symbol: string;
  exchange: string;
  quantity: number;
  avgPrice: number;
  lastPrice: number;
  exposure: number;
  currentValue: number;
  weight: number;
  pnl: number;
  pnlPct: number;
}

export interface IndexPoint {
  time: string;
  value: number;
}

export interface Snapshot {
  positions: Position[];
  indexValue: number;
  totalCost: number;
  currentValue: number;
  indexHistory: IndexPoint[];
}
