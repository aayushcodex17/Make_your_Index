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

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '1D' | 'TODAY';

export interface TodayPoint {
  time: number;
  value: number;
}

export interface TodayStats {
  dayOpen: number;
  dayHigh: number;
  dayLow: number;
  dayChange: number;
  dayChangePct: number;
  currentValue: number;
  baseExposure: number;
  positionCount: number;
  dataPoints: number;
}

export interface TodayData {
  series: TodayPoint[];
  stats: TodayStats | null;
}

export interface Snapshot {
  positions: Position[];
  indexValue: number;
  totalExposure: number;
  totalPnl: number;
  basePnl: number;
  baseExposure: number;
  baseSetAt: number | null;   // epoch ms when base was locked
  candles: Record<Timeframe, Candle[]>;
}
