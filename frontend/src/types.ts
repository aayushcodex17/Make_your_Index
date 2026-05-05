export interface Position {
  symbol: string;
  underlying: string;
  expiry: string;
  instrumentType: 'CE' | 'PE' | 'FUT' | 'UNKNOWN';
  strike: number | null;
  exchange: string;
  product: string;
  quantity: number;
  avgPrice: number;
  lastPrice: number;
  exposure: number;
  weight: number;
  pnl: number;
  pnlPct: number;
  side: 'LONG' | 'SHORT';
}

export interface Candle {
  time: number;   // epoch ms
  open: number;
  high: number;
  low: number;
  close: number;
}

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '1D';

export interface Snapshot {
  positions: Position[];
  indexValue: number;
  totalExposure: number;
  totalPnl: number;
  basePnl: number;
  baseExposure: number;
  candles: Record<Timeframe, Candle[]>;
}
