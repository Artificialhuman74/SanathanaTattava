import React, { useEffect, useMemo, useState } from 'react';
import api from '../../api/axios';
import ChakraIcon from '../../components/luckyDraw/ChakraIcon';
import { LUCKY_DRAW_NAME } from '../../config/luckyDraw';
import { Gift } from 'lucide-react';
import LiquidLoader from '../../components/LiquidLoader';
import EligibilityTree from '../../components/luckyDraw/EligibilityTree';

type Enrollment = import('../../components/luckyDraw/EligibilityTree').TreeEnrollment;

/**
 * The trader's view of {@link LUCKY_DRAW_NAME} (spec §8.2): the same tree the
 * admin sees, pruned to their own branch.
 *
 * The flat table this replaced answered "who joined", which stops being news
 * after the first week. What a trader needs to know is which of their people
 * are in THIS month's draw, because the ones who are not are the ones worth a
 * call: a consumer who forgets to order does not just miss a chance, they
 * miss the month. Red on the tree is a to-do list.
 */
export default function TraderLuckyDraw() {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/lucky-draw/trader/enrollments', { skipBaseRotation: true })
      .then(r => setEnrollments(r.data.enrollments || []))
      .finally(() => setLoading(false));
  }, []);

  const counts = useMemo(() => ({
    total: enrollments.length,
    entered: enrollments.filter(e => e.standing === 'entered').length,
    waiting: enrollments.filter(e => e.standing === 'not_entered').length,
    winning: enrollments.filter(e => e.standing === 'winning').length,
  }), [enrollments]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <ChakraIcon size={26} className="text-gold-600" />
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{LUCKY_DRAW_NAME}</h2>
          <p className="text-slate-500 text-sm">Consumers under you who&rsquo;ve joined the lucky draw</p>
        </div>
      </div>

      {loading ? (
        <div className="card p-10 flex justify-center"><LiquidLoader size={72} /></div>
      ) : enrollments.length === 0 ? (
        <div className="card p-10 text-center">
          <Gift size={32} className="mx-auto text-slate-300 mb-3" />
          <p className="font-medium text-lg text-slate-700">No one&rsquo;s joined yet</p>
          <p className="text-slate-400 text-sm mt-1">
            When a consumer linked to you enrolls in {LUCKY_DRAW_NAME}, they&rsquo;ll show up here &mdash; you&rsquo;ll also get a
            notification to pack and deliver their welcome gift.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            <Stat label="Enrolled" value={counts.total} />
            <Stat label="In this month’s draw" value={counts.entered} colour="#1a6b2e" />
            <Stat label="Yet to order" value={counts.waiting} colour="#b91c1c" />
            <Stat label="Winning" value={counts.winning} colour="#c8963c" />
          </div>

          {/* The one thing this page is for: who to call before the 10th. */}
          {counts.waiting > 0 && (
            <p className="text-xs mb-4" style={{ color: '#6a4219' }}>
              {counts.waiting === 1
                ? 'One of your consumers has not ordered this month, so they are not in the draw yet.'
                : `${counts.waiting} of your consumers have not ordered this month, so they are not in the draw yet.`}
            </p>
          )}

          <EligibilityTree
            rows={enrollments}
            rootSubtitle={`${counts.total} ${counts.total === 1 ? 'consumer' : 'consumers'}`}
            title="Your consumers in this month’s draw"
            hint="Green is in this month’s draw, red has not ordered yet. Click a name for their details."
          />
        </>
      )}
    </div>
  );
}

function Stat({ label, value, colour }: { label: string; value: number; colour?: string }) {
  return (
    <div className="card p-4">
      <p className="text-2xl font-bold" style={{ color: colour || '#0f172a' }}>{value}</p>
      <p className="text-xs text-slate-500 mt-0.5">{label}</p>
    </div>
  );
}
