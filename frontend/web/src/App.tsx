import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface DrugData {
  id: string;
  name: string;
  molecularWeight: number;
  successRate: number;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [drugs, setDrugs] = useState<DrugData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingDrug, setCreatingDrug] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newDrugData, setNewDrugData] = useState({ name: "", molecularWeight: "", successRate: "" });
  const [selectedDrug, setSelectedDrug] = useState<DrugData | null>(null);
  const [decryptedData, setDecryptedData] = useState<{ molecularWeight: number | null; successRate: number | null }>({ molecularWeight: null, successRate: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterVerified, setFilterVerified] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const drugsList: DrugData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          drugsList.push({
            id: businessId,
            name: businessData.name,
            molecularWeight: 0,
            successRate: 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setDrugs(drugsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createDrug = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingDrug(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating drug data with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const molecularWeight = parseInt(newDrugData.molecularWeight) || 0;
      const businessId = `drug-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, molecularWeight);
      
      const tx = await contract.createBusinessData(
        businessId,
        newDrugData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newDrugData.successRate) || 0,
        0,
        "Encrypted Drug Molecular Data"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Drug data created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewDrugData({ name: "", molecularWeight: "", successRate: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingDrug(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Contract is available and ready" 
      });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredDrugs = drugs.filter(drug => {
    const matchesSearch = drug.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = !filterVerified || drug.isVerified;
    return matchesSearch && matchesFilter;
  });

  const stats = {
    total: drugs.length,
    verified: drugs.filter(d => d.isVerified).length,
    avgSuccessRate: drugs.length > 0 ? drugs.reduce((sum, d) => sum + d.publicValue1, 0) / drugs.length : 0,
    recent: drugs.filter(d => Date.now()/1000 - d.timestamp < 60 * 60 * 24 * 7).length
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>FHE Drug Discovery 🔬</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔬</div>
            <h2>Connect Wallet to Access Encrypted Drug Research</h2>
            <p>Secure molecular data sharing with fully homomorphic encryption for collaborative drug discovery.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted drug database...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>FHE Drug Discovery 🔬</h1>
          <p>Secure Molecular Data Sharing</p>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="availability-btn">
            Check System
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + Add Molecular Data
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panels">
          <div className="stat-panel">
            <h3>Total Compounds</h3>
            <div className="stat-value">{stats.total}</div>
          </div>
          <div className="stat-panel">
            <h3>Verified Data</h3>
            <div className="stat-value">{stats.verified}/{stats.total}</div>
          </div>
          <div className="stat-panel">
            <h3>Avg Success Rate</h3>
            <div className="stat-value">{stats.avgSuccessRate.toFixed(1)}%</div>
          </div>
          <div className="stat-panel">
            <h3>This Week</h3>
            <div className="stat-value">+{stats.recent}</div>
          </div>
        </div>

        <div className="search-section">
          <div className="search-bar">
            <input 
              type="text" 
              placeholder="Search compounds..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="filters">
            <label>
              <input 
                type="checkbox" 
                checked={filterVerified}
                onChange={(e) => setFilterVerified(e.target.checked)}
              />
              Show Verified Only
            </label>
            <button onClick={loadData} disabled={isRefreshing}>
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="drugs-list">
          {filteredDrugs.length === 0 ? (
            <div className="no-data">
              <p>No molecular data found</p>
              <button onClick={() => setShowCreateModal(true)}>
                Add First Compound
              </button>
            </div>
          ) : (
            filteredDrugs.map((drug, index) => (
              <div 
                className={`drug-item ${drug.isVerified ? "verified" : ""}`}
                key={index}
                onClick={() => setSelectedDrug(drug)}
              >
                <div className="drug-header">
                  <h3>{drug.name}</h3>
                  <span className={`status ${drug.isVerified ? "verified" : "encrypted"}`}>
                    {drug.isVerified ? "✅ Verified" : "🔒 Encrypted"}
                  </span>
                </div>
                <div className="drug-info">
                  <div>Success Rate: {drug.publicValue1}%</div>
                  <div>Created: {new Date(drug.timestamp * 1000).toLocaleDateString()}</div>
                </div>
                {drug.isVerified && drug.decryptedValue && (
                  <div className="decrypted-value">
                    Molecular Weight: {drug.decryptedValue}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
      
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>Add Encrypted Molecular Data</h2>
              <button onClick={() => setShowCreateModal(false)}>&times;</button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>Compound Name</label>
                <input 
                  type="text" 
                  value={newDrugData.name}
                  onChange={(e) => setNewDrugData({...newDrugData, name: e.target.value})}
                  placeholder="Enter compound name..."
                />
              </div>
              
              <div className="form-group">
                <label>Molecular Weight (FHE Encrypted)</label>
                <input 
                  type="number" 
                  value={newDrugData.molecularWeight}
                  onChange={(e) => setNewDrugData({...newDrugData, molecularWeight: e.target.value})}
                  placeholder="Enter molecular weight..."
                />
                <div className="hint">Integer values only for FHE encryption</div>
              </div>
              
              <div className="form-group">
                <label>Predicted Success Rate % (Public)</label>
                <input 
                  type="number" 
                  min="0"
                  max="100"
                  value={newDrugData.successRate}
                  onChange={(e) => setNewDrugData({...newDrugData, successRate: e.target.value})}
                  placeholder="Enter success rate..."
                />
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)}>Cancel</button>
              <button 
                onClick={createDrug}
                disabled={creatingDrug || isEncrypting}
              >
                {creatingDrug || isEncrypting ? "Encrypting..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {selectedDrug && (
        <DrugDetailModal 
          drug={selectedDrug}
          onClose={() => {
            setSelectedDrug(null);
            setDecryptedData({ molecularWeight: null, successRate: null });
          }}
          decryptedData={decryptedData}
          setDecryptedData={setDecryptedData}
          isDecrypting={isDecrypting || fheIsDecrypting}
          decryptData={() => decryptData(selectedDrug.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            {transactionStatus.message}
          </div>
        </div>
      )}

      <footer className="app-footer">
        <p>FHE-based Drug Discovery Platform - Secure Molecular Data Sharing</p>
      </footer>
    </div>
  );
};

const DrugDetailModal: React.FC<{
  drug: DrugData;
  onClose: () => void;
  decryptedData: { molecularWeight: number | null; successRate: number | null };
  setDecryptedData: (value: { molecularWeight: number | null; successRate: number | null }) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ drug, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedData.molecularWeight !== null) {
      setDecryptedData({ molecularWeight: null, successRate: null });
      return;
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData({ molecularWeight: decrypted, successRate: decrypted });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="detail-modal">
        <div className="modal-header">
          <h2>Molecular Data Details</h2>
          <button onClick={onClose}>&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="drug-info">
            <div className="info-row">
              <span>Compound Name:</span>
              <strong>{drug.name}</strong>
            </div>
            <div className="info-row">
              <span>Creator:</span>
              <span>{drug.creator.substring(0, 8)}...{drug.creator.substring(36)}</span>
            </div>
            <div className="info-row">
              <span>Created:</span>
              <span>{new Date(drug.timestamp * 1000).toLocaleString()}</span>
            </div>
            <div className="info-row">
              <span>Success Rate:</span>
              <span>{drug.publicValue1}%</span>
            </div>
          </div>
          
          <div className="encrypted-section">
            <h3>Encrypted Molecular Data</h3>
            <div className="data-row">
              <span>Molecular Weight:</span>
              <span className="encrypted-value">
                {drug.isVerified && drug.decryptedValue ? 
                  `${drug.decryptedValue} (Verified)` : 
                  decryptedData.molecularWeight !== null ? 
                  `${decryptedData.molecularWeight} (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </span>
              <button 
                onClick={handleDecrypt}
                disabled={isDecrypting}
                className={`decrypt-btn ${drug.isVerified || decryptedData.molecularWeight !== null ? 'decrypted' : ''}`}
              >
                {isDecrypting ? "Processing..." : 
                 drug.isVerified ? "Verified" :
                 decryptedData.molecularWeight !== null ? "Re-verify" : "Decrypt"}
              </button>
            </div>
          </div>
          
          {(drug.isVerified || decryptedData.molecularWeight !== null) && (
            <div className="analysis-section">
              <h3>Drug Properties Analysis</h3>
              <div className="properties-grid">
                <div className="property">
                  <span>Bioavailability</span>
                  <div className="property-bar">
                    <div 
                      className="bar-fill" 
                      style={{ width: `${Math.min(100, (drug.publicValue1 * 0.8))}%` }}
                    ></div>
                  </div>
                </div>
                <div className="property">
                  <span>Solubility</span>
                  <div className="property-bar">
                    <div 
                      className="bar-fill" 
                      style={{ width: `${Math.min(100, (drug.publicValue1 * 0.6))}%` }}
                    ></div>
                  </div>
                </div>
                <div className="property">
                  <span>Stability</span>
                  <div className="property-bar">
                    <div 
                      className="bar-fill" 
                      style={{ width: `${Math.min(100, (drug.publicValue1 * 0.9))}%` }}
                    ></div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose}>Close</button>
          {!drug.isVerified && (
            <button onClick={handleDecrypt} disabled={isDecrypting}>
              Verify On-chain
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;