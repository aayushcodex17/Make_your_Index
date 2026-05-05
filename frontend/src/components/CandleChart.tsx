import { useEffect, useRef } from 'react';
import { createChart, ColorType, CrosshairMode, CandlestickSeries } from 'lightweight-charts';
import { Candle } from '../types';

interface Props {
  data: Candle[];   // { time: epochMs, open, high, low, close }
  height?: number;
  baseRef?: number; // draw a reference line at this value (e.g. 100)
}

export default function CandleChart({ data, height = 280, baseRef }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !data.length) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#151820' },
        textColor: '#94a3b8',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: '#1a1f2e' },
        horzLines: { color: '#1a1f2e' },
      },
      rightPriceScale: {
        borderColor: '#262c3d',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: '#262c3d',
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: '#475569', labelBackgroundColor: '#1e2230' },
        horzLine: { color: '#475569', labelBackgroundColor: '#1e2230' },
      },
      width: containerRef.current.clientWidth,
      height,
      // Display timestamps in local timezone (IST on the user's machine)
      localization: {
        timeFormatter: (ts: number) => {
          const d = new Date(ts * 1000);
          return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
        },
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor:         '#22c55e',
      downColor:       '#ef4444',
      wickUpColor:     '#22c55e',
      wickDownColor:   '#ef4444',
      borderUpColor:   '#22c55e',
      borderDownColor: '#ef4444',
    });

    // lightweight-charts needs time in seconds
    series.setData(
      data.map((d) => ({
        time: Math.floor(d.time / 1000) as any,
        open:  d.open,
        high:  d.high,
        low:   d.low,
        close: d.close,
      }))
    );

    // Base reference line (index = 100)
    if (baseRef !== undefined) {
      series.createPriceLine({
        price: baseRef,
        color: '#3b82f6',
        lineWidth: 1,
        lineStyle: 2, // dashed
        axisLabelVisible: true,
        title: 'base',
      });
    }

    chart.timeScale().fitContent();

    // Responsive resize
    const ro = new ResizeObserver((entries) => {
      if (entries[0]) chart.applyOptions({ width: entries[0].contentRect.width });
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [data, height, baseRef]);

  if (!data.length) {
    return (
      <div style={{
        height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569',
      }}>
        No candle data yet — collecting…
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
