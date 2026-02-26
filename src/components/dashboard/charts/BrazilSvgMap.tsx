import { cn } from '@/lib/utils';

interface BrazilSvgMapProps {
  getStateColor: (stateCode: string) => string;
  hoveredState: string | null;
  selectedState: string | null;
  onStateHover: (stateCode: string | null) => void;
  onStateClick: (stateCode: string) => void;
  tvMode?: boolean;
}

const STATES_DATA: Record<string, { path: string; labelX: number; labelY: number }> = {
  'RR': { path: 'M201,52 L225,42 L252,46 L272,62 L278,88 L270,115 L245,128 L215,124 L192,105 L186,78 Z', labelX: 232, labelY: 88 },
  'AP': { path: 'M372,35 L398,42 L418,68 L415,105 L392,132 L362,125 L345,98 L350,62 Z', labelX: 382, labelY: 82 },
  'AM': { path: 'M98,142 L135,112 L188,105 L245,115 L288,142 L315,178 L322,222 L312,272 L280,308 L232,328 L178,335 L128,318 L95,285 L78,238 L75,188 Z', labelX: 198, labelY: 218 },
  'PA': { path: 'M288,142 L342,130 L395,148 L442,182 L472,225 L478,272 L462,318 L420,348 L365,355 L322,345 L325,305 L325,258 L320,208 L315,178 Z', labelX: 395, labelY: 245 },
  'RO': { path: 'M178,335 L232,328 L262,352 L268,402 L248,442 L205,455 L168,435 L155,388 L162,352 Z', labelX: 212, labelY: 395 },
  'AC': { path: 'M75,325 L128,318 L178,335 L162,368 L128,392 L88,385 L68,358 Z', labelX: 118, labelY: 355 },
  'MT': { path: 'M248,358 L312,338 L365,358 L395,398 L408,462 L390,522 L342,558 L280,565 L235,535 L212,478 L222,418 Z', labelX: 315, labelY: 462 },
  'MS': { path: 'M280,565 L342,558 L378,595 L385,652 L362,698 L315,722 L268,708 L242,662 L248,612 Z', labelX: 315, labelY: 648 },
  'GO': { path: 'M365,478 L415,468 L455,502 L472,555 L455,612 L415,642 L368,635 L342,595 L342,538 Z', labelX: 408, labelY: 558 },
  'DF': { path: 'M445,538 L468,538 L475,555 L465,575 L445,575 L438,555 Z', labelX: 456, labelY: 558 },
  'TO': { path: 'M395,338 L428,332 L465,358 L472,415 L455,468 L415,488 L372,472 L358,418 L365,368 Z', labelX: 418, labelY: 412 },
  'MA': { path: 'M438,208 L492,198 L542,218 L565,265 L555,318 L515,352 L462,358 L432,332 L438,278 Z', labelX: 502, labelY: 278 },
  'PI': { path: 'M480,342 L532,328 L565,362 L572,412 L550,458 L505,478 L472,455 L462,402 L468,358 Z', labelX: 518, labelY: 408 },
  'CE': { path: 'M548,258 L588,248 L620,272 L625,315 L605,355 L565,365 L538,342 L538,298 Z', labelX: 582, labelY: 308 },
  'RN': { path: 'M618,265 L658,258 L682,282 L682,315 L658,342 L625,342 L608,318 L612,288 Z', labelX: 648, labelY: 302 },
  'PB': { path: 'M602,342 L652,342 L682,365 L675,398 L642,425 L602,418 L585,392 L592,358 Z', labelX: 638, labelY: 382 },
  'PE': { path: 'M550,408 L602,418 L652,438 L658,472 L632,502 L575,502 L542,478 L548,438 Z', labelX: 602, labelY: 458 },
  'AL': { path: 'M652,472 L682,478 L695,512 L678,542 L648,542 L632,512 L642,488 Z', labelX: 665, labelY: 512 },
  'SE': { path: 'M638,542 L668,548 L678,578 L662,605 L635,605 L625,578 Z', labelX: 652, labelY: 575 },
  'BA': { path: 'M482,458 L538,478 L590,512 L618,568 L632,638 L608,698 L552,735 L485,742 L435,702 L418,638 L432,572 L458,515 Z', labelX: 532, labelY: 612 },
  'MG': { path: 'M432,628 L482,618 L542,638 L588,685 L605,745 L588,808 L535,848 L465,858 L412,822 L392,762 L402,698 Z', labelX: 502, labelY: 745 },
  'ES': { path: 'M598,722 L638,728 L662,772 L652,822 L618,848 L580,832 L575,785 L585,748 Z', labelX: 622, labelY: 788 },
  'RJ': { path: 'M542,852 L595,858 L632,888 L632,928 L602,958 L552,952 L528,918 L535,878 Z', labelX: 582, labelY: 908 },
  'SP': { path: 'M380,758 L438,742 L502,765 L545,822 L545,885 L502,932 L438,952 L382,922 L355,862 L362,802 Z', labelX: 455, labelY: 848 },
  'PR': { path: 'M342,895 L398,882 L455,912 L482,968 L462,1028 L410,1058 L355,1048 L322,992 L328,932 Z', labelX: 400, labelY: 972 },
  'SC': { path: 'M378,1048 L428,1042 L468,1075 L475,1125 L448,1168 L398,1182 L358,1152 L350,1102 Z', labelX: 412, labelY: 1112 },
  'RS': { path: 'M318,1142 L372,1125 L428,1155 L462,1215 L455,1288 L410,1342 L345,1362 L282,1328 L252,1262 L265,1195 Z', labelX: 362, labelY: 1248 },
};

export function BrazilSvgMap({ getStateColor, hoveredState, selectedState, onStateHover, onStateClick, tvMode = false }: BrazilSvgMapProps) {
  return (
    <svg viewBox="50 25 700 1350" className={cn('w-full transition-all duration-300 mx-auto', tvMode ? 'h-[540px] max-w-[380px]' : 'h-[440px] max-w-[310px]')} preserveAspectRatio="xMidYMid meet">
      {Object.entries(STATES_DATA).map(([code, info]) => {
        const isHovered = hoveredState === code;
        const isSelected = selectedState === code;
        return (
          <g key={code} className="cursor-pointer">
            <path d={info.path} fill={getStateColor(code)} stroke="#000000" strokeWidth={isSelected ? 3 : isHovered ? 2.5 : 1.5} strokeLinejoin="round" strokeLinecap="round" className="transition-all duration-200" style={{ filter: isHovered || isSelected ? 'brightness(1.12) drop-shadow(0 4px 8px rgba(0,0,0,0.22))' : 'drop-shadow(0 1px 2px rgba(0,0,0,0.06))' }} onMouseEnter={() => onStateHover(code)} onMouseLeave={() => onStateHover(null)} onClick={() => onStateClick(code)} />
            <text x={info.labelX} y={info.labelY} textAnchor="middle" dominantBaseline="middle" className="pointer-events-none select-none" style={{ fontSize: tvMode ? '20px' : '15px', fontWeight: 700, fill: 'hsl(var(--foreground))', textShadow: '-1.5px -1.5px 0 hsl(var(--background)), 1.5px -1.5px 0 hsl(var(--background)), -1.5px 1.5px 0 hsl(var(--background)), 1.5px 1.5px 0 hsl(var(--background))', letterSpacing: '0.5px' }}>{code}</text>
          </g>
        );
      })}
    </svg>
  );
}
