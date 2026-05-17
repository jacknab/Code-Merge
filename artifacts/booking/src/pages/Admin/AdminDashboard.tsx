import React, { useState, useEffect } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { AdminLayout } from './AdminLayout';
import { StockItemManager } from './StockItemManager';
import { StoreDatabaseEntry } from './StoreDatabaseEntry';
import { UnifiedServiceManager } from './UnifiedServiceManager';
import { FulfillmentManager } from './FulfillmentManager';
import { UsersManager } from './UsersManager';
import { SettingsManager } from './SettingsManager';
import { InvoicesManager } from './InvoicesManager';
import { PlatformSettingsManager } from './PlatformSettingsManager';
import { BillingDashboard } from './BillingDashboard';
import { BillingPlansManager } from './BillingPlansManager';

import StoreManager from './StoreManager';
import { DashboardOverview } from './DashboardOverview';
import { getStoreId } from '../../config.js';
import { apiRequest } from '../../services/api.js';

/**
 * AdminDashboard - Main container for the admin/back office section
 * Handles routing and store context for all admin pages
 */
export const AdminDashboard: React.FC = () => {
  const [storeId, setStoreId] = useState<number | undefined>();
  const [businessType] = useState<string>('nail_salon');
  const [unpaidInvoicesCount, setUnpaidInvoicesCount] = useState<number | null>(null);
  const [pastDueInvoicesCount, setPastDueInvoicesCount] = useState<number | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const sid = getStoreId();
    if (sid) {
      const numericId = Number(sid);
      if (!isNaN(numericId)) {
        setStoreId(numericId);
      }
    } else {
      // Default to 1000 for admin dashboard if no store ID is set
      setStoreId(1000);
    }

    const fetchInvoiceCounts = async () => {
      try {
        const unpaidResponse = await apiRequest('/api/billing/invoices/unpaid/count');
        setUnpaidInvoicesCount(unpaidResponse.count);

        const pastDueResponse = await apiRequest('/api/billing/invoices/past-due/count');
        setPastDueInvoicesCount(pastDueResponse.count);
      } catch (error) {
        console.error('Failed to fetch invoice counts:', error);
      }
    };

    fetchInvoiceCounts();
  }, []);

  // Show loading state if no store ID
  if (!storeId) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100">
        <div className="text-center">
          <div className="text-xl font-bold text-gray-700 mb-2">Loading...</div>
          <div className="text-sm text-gray-500">Initializing admin dashboard</div>
        </div>
      </div>
    );
  }

  return (
    <AdminLayout>
      <Routes>
        <Route path="/" element={<DashboardOverview 
          unpaidInvoicesCount={unpaidInvoicesCount}
          pastDueInvoicesCount={pastDueInvoicesCount}
          onUnpaidInvoicesClick={() => navigate('/isadmin/invoices', { state: { filter: 'unpaid' } })}
          onPastDueInvoicesClick={() => navigate('/isadmin/invoices', { state: { filter: 'past_due' } })}
        />} />
        <Route 
          path="/stock-items" 
          element={<StockItemManager />} 
        />
        <Route 
          path="/store-entry/:storeNumber" 
          element={<StoreDatabaseEntry />} 
        />
        <Route 
          path="/services" 
          element={<UnifiedServiceManager storeId={storeId} businessType={businessType} />} 
        />
        <Route 
          path="/fulfillment" 
          element={<FulfillmentManager />} 
        />
        <Route 
          path="/platform-settings" 
          element={<PlatformSettingsManager />} 
        />
        
        <Route 
          path="/stores" 
          element={<StoreManager />} 
        />
        <Route 
          path="/users" 
          element={<UsersManager />} 
        />
        <Route 
          path="/settings" 
          element={<SettingsManager />} 
        />
        <Route 
          path="/invoices" 
          element={<InvoicesManager />} 
        />
        <Route
          path="/billing"
          element={<BillingDashboard />}
        />
        <Route
          path="/billing/plans"
          element={<BillingPlansManager />}
        />
      </Routes>
    </AdminLayout>
  );
};
