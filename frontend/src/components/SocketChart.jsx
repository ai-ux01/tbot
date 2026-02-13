import { useEffect, useRef } from 'react';
import { createChart, LineSeries } from 'lightweight-charts';
import { useKotakWS } from '../context/KotakWSContext';

export function SocketChart() {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const lastCountRef = useRef(0);
  const { chartData } = useKotakWS();

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { color: '#0f1419' }, textColor: '#8b98a5' },
      grid: { vertLines: { color: '#1e2329' }, horzLines: { color: '#1e2329' } },
      width: containerRef.current.clientWidth,
      height: 320,
      timeScale: { timeVisible: true, secondsVisible: true },
      rightPriceScale: { borderColor: '#2f3336' },
    });
    const lineSeries = chart.addSeries(LineSeries, {
      color: '#1d9bf0',
      lineWidth: 2,
    });
    chartRef.current = chart;
    seriesRef.current = lineSeries;

    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current) return;
    if (chartData.length === 0) {
      lastCountRef.current = 0;
      return;
    }
    const series = seriesRef.current;
    const prev = lastCountRef.current;
    for (let i = prev; i < chartData.length; i++) {
      const d = chartData[i];
      series.update({ time: d.time, value: d.value });
    }
    lastCountRef.current = chartData.length;
  }, [chartData]);

  return (
    <div className="socket-chart-wrap">
      <div ref={containerRef} className="socket-chart" />
      <p className="chart-hint">
        LTP from WebSocket stream. Connect HSM and subscribe to scrips to see live data.
      </p>
    </div>
  );
}
