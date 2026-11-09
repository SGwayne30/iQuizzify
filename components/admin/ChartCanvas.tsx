'use client';
import { useEffect, useRef, type MutableRefObject } from 'react';
import {
  Chart,
  ArcElement,
  BarElement,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  DoughnutController,
  BarController,
  LineController,
  type ChartConfiguration,
} from 'chart.js';

Chart.register(
  ArcElement,
  BarElement,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  DoughnutController,
  BarController,
  LineController
);

/**
 * Lazily-built Chart.js canvas (builds when scrolled into view). Registers its
 * canvas in `canvasMapRef` so callers can export / copy it later.
 */
export default function ChartCanvas({
  id,
  config,
  canvasMapRef,
}: {
  id: string;
  config: ChartConfiguration;
  canvasMapRef: MutableRefObject<Record<string, HTMLCanvasElement | null>>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvasMapRef.current[id] = canvas;

    const build = (animate: boolean) => {
      chartRef.current?.destroy();
      const cfg = configRef.current;
      chartRef.current = new Chart(
        canvas,
        animate ? cfg : ({ ...cfg, options: { ...cfg.options, animation: false } } as ChartConfiguration)
      );
    };

    (canvas as HTMLCanvasElement & { __forceRender?: () => void }).__forceRender = () => {
      if (!chartRef.current) build(false);
    };

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === 'undefined') {
      build(true);
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            build(true);
            observer?.disconnect();
          }
        },
        { threshold: 0.2 }
      );
      observer.observe(canvas.parentElement ?? canvas);
    }

    return () => {
      observer?.disconnect();
      chartRef.current?.destroy();
      chartRef.current = null;
      delete canvasMapRef.current[id];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(config.data)]);

  return <canvas ref={canvasRef} id={id} />;
}