import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { JSX, useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface DrugMoleculeData {
  id: number;
  name: string;
  moleculeId: string;
  activityScore: string;
  toxicity: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
  encryptedValueHandle?: string;
}

interface MoleculeAnalysis {
  efficacyScore: number;
  safetyProfile: number;
  bioavailability: number;
  synthesisComplexity: number;
  patentPotential: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [molecules, setMolecules] = useState<DrugMoleculeData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingMolecule, setCreatingMolecule] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newMoleculeData, setNewMoleculeData] = useState({ name: "", efficacy: "", toxicity: "" });
  const [selectedMolecule, setSelectedMolecule] = useState<DrugMoleculeData | null>(null);
  const [decryptedData, setDecryptedData] = useState<{ efficacy: number | null; toxicity: number | null }>({ efficacy: null, toxicity: null });
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterVerified, setFilterVerified] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) {
        return;
      }
      
      if (isInitialized) {
        return;
      }
      
      if (fhevmInitializing) {
        return;
      }
      
      try {
        setFhevmInitializing(true);
        console.log('Initializing FHEVM after wallet connection...');
        await initialize();
        console.log('FHEVM initialized successfully');
      } catch (error) {
        console.error('Failed to initialize FHEVM:', error);
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed. Please check your wallet connection." 
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
      const moleculesList: DrugMoleculeData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          moleculesList.push({
            id: parseInt(businessId.replace('molecule-', '')) || Date.now(),
            name: businessData.name,
            moleculeId: businessId,
            activityScore: businessId,
            toxicity: businessId,
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
      
      setMolecules(moleculesList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createMolecule = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingMolecule(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating molecule with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const efficacyValue = parseInt(newMoleculeData.efficacy) || 0;
      const businessId = `molecule-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, efficacyValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newMoleculeData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newMoleculeData.toxicity) || 0,
        0,
        "Drug Molecule Data"
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Molecule created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewMoleculeData({ name: "", efficacy: "", toxicity: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingMolecule(false); 
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

  const analyzeMolecule = (molecule: DrugMoleculeData, decryptedEfficacy: number | null, decryptedToxicity: number | null): MoleculeAnalysis => {
    const efficacy = molecule.isVerified ? (molecule.decryptedValue || 0) : (decryptedEfficacy || molecule.publicValue1 || 5);
    const toxicity = molecule.publicValue1 || 5;
    
    const baseEfficacy = Math.min(100, Math.round((efficacy * 0.8 + (10 - toxicity) * 0.2) * 10));
    const timeFactor = Math.max(0.7, Math.min(1.3, 1 - (Date.now()/1000 - molecule.timestamp) / (60 * 60 * 24 * 30)));
    const efficacyScore = Math.round(baseEfficacy * timeFactor);
    
    const safetyProfile = Math.round((10 - toxicity) * 8 + efficacy * 0.5);
    const bioavailability = Math.round(efficacy * 0.6 + (10 - toxicity) * 4);
    
    const synthesisComplexity = Math.max(10, Math.min(90, 100 - (efficacy * 0.3 + toxicity * 2)));
    const patentPotential = Math.min(95, Math.round((efficacy * 0.7 + (10 - toxicity) * 0.3) * 9));

    return {
      efficacyScore,
      safetyProfile,
      bioavailability,
      synthesisComplexity,
      patentPotential
    };
  };

  const filteredMolecules = molecules.filter(molecule => {
    const matchesSearch = molecule.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         molecule.creator.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = !filterVerified || molecule.isVerified;
    return matchesSearch && matchesFilter;
  });

  const stats = {
    totalMolecules: molecules.length,
    verifiedMolecules: molecules.filter(m => m.isVerified).length,
    avgEfficacy: molecules.length > 0 
      ? molecules.reduce((sum, m) => sum + m.publicValue1, 0) / molecules.length 
      : 0,
    recentMolecules: molecules.filter(m => 
      Date.now()/1000 - m.timestamp < 60 * 60 * 24 * 7
    ).length
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>DrugAI FHE 🔬</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔬</div>
            <h2>Connect Your Wallet to Continue</h2>
            <p>Please connect your wallet to initialize the encrypted drug discovery system and access molecular data.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect your wallet using the button above</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE system will automatically initialize</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Start creating and analyzing encrypted molecular data</p>
              </div>
            </div>
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
        <p>Status: {fhevmInitializing ? "Initializing FHEVM" : status}</p>
        <p className="loading-note">This may take a few moments</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted drug discovery system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>DrugAI FHE 🔬</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Molecule
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <h2>Encrypted Drug Discovery Platform (FHE 🔐)</h2>
          
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-icon">🧪</div>
              <div className="stat-content">
                <div className="stat-value">{stats.totalMolecules}</div>
                <div className="stat-label">Total Molecules</div>
              </div>
            </div>
            
            <div className="stat-card">
              <div className="stat-icon">✅</div>
              <div className="stat-content">
                <div className="stat-value">{stats.verifiedMolecules}</div>
                <div className="stat-label">Verified Data</div>
              </div>
            </div>
            
            <div className="stat-card">
              <div className="stat-icon">📊</div>
              <div className="stat-content">
                <div className="stat-value">{stats.avgEfficacy.toFixed(1)}</div>
                <div className="stat-label">Avg Efficacy</div>
              </div>
            </div>
            
            <div className="stat-card">
              <div className="stat-icon">🆕</div>
              <div className="stat-content">
                <div className="stat-value">{stats.recentMolecules}</div>
                <div className="stat-label">This Week</div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="molecules-section">
          <div className="section-header">
            <h2>Molecular Database</h2>
            <div className="header-actions">
              <div className="search-filter">
                <input 
                  type="text" 
                  placeholder="Search molecules..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                />
                <label className="filter-checkbox">
                  <input 
                    type="checkbox" 
                    checked={filterVerified}
                    onChange={(e) => setFilterVerified(e.target.checked)}
                  />
                  Verified Only
                </label>
              </div>
              <button 
                onClick={loadData} 
                className="refresh-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="molecules-list">
            {filteredMolecules.length === 0 ? (
              <div className="no-molecules">
                <p>No molecular data found</p>
                <button 
                  className="create-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Add First Molecule
                </button>
              </div>
            ) : filteredMolecules.map((molecule, index) => (
              <div 
                className={`molecule-item ${selectedMolecule?.id === molecule.id ? "selected" : ""} ${molecule.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedMolecule(molecule)}
              >
                <div className="molecule-title">{molecule.name}</div>
                <div className="molecule-meta">
                  <span>Toxicity Score: {molecule.publicValue1}/10</span>
                  <span>Created: {new Date(molecule.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                <div className="molecule-status">
                  Status: {molecule.isVerified ? "✅ On-chain Verified" : "🔓 Ready for Verification"}
                  {molecule.isVerified && molecule.decryptedValue && (
                    <span className="verified-value">Efficacy: {molecule.decryptedValue}</span>
                  )}
                </div>
                <div className="molecule-creator">Contributor: {molecule.creator.substring(0, 6)}...{molecule.creator.substring(38)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateMolecule 
          onSubmit={createMolecule} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingMolecule} 
          moleculeData={newMoleculeData} 
          setMoleculeData={setNewMoleculeData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedMolecule && (
        <MoleculeDetailModal 
          molecule={selectedMolecule} 
          onClose={() => { 
            setSelectedMolecule(null); 
            setDecryptedData({ efficacy: null, toxicity: null }); 
          }} 
          decryptedData={decryptedData} 
          setDecryptedData={setDecryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedMolecule.moleculeId)}
          analyzeMolecule={analyzeMolecule}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateMolecule: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  moleculeData: any;
  setMoleculeData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, moleculeData, setMoleculeData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'efficacy') {
      const intValue = value.replace(/[^\d]/g, '');
      setMoleculeData({ ...moleculeData, [name]: intValue });
    } else {
      setMoleculeData({ ...moleculeData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-molecule-modal">
        <div className="modal-header">
          <h2>New Molecular Data</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Encryption</strong>
            <p>Efficacy data will be encrypted with Zama FHE 🔐 (Integer only)</p>
          </div>
          
          <div className="form-group">
            <label>Molecule Name *</label>
            <input 
              type="text" 
              name="name" 
              value={moleculeData.name} 
              onChange={handleChange} 
              placeholder="Enter molecule name..." 
            />
          </div>
          
          <div className="form-group">
            <label>Efficacy Score (Integer only) *</label>
            <input 
              type="number" 
              name="efficacy" 
              value={moleculeData.efficacy} 
              onChange={handleChange} 
              placeholder="Enter efficacy score..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Toxicity Score (1-10) *</label>
            <input 
              type="number" 
              min="1" 
              max="10" 
              name="toxicity" 
              value={moleculeData.toxicity} 
              onChange={handleChange} 
              placeholder="Enter toxicity score..." 
            />
            <div className="data-type-label">Public Data</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !moleculeData.name || !moleculeData.efficacy || !moleculeData.toxicity} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Molecule"}
          </button>
        </div>
      </div>
    </div>
  );
};

const MoleculeDetailModal: React.FC<{
  molecule: DrugMoleculeData;
  onClose: () => void;
  decryptedData: { efficacy: number | null; toxicity: number | null };
  setDecryptedData: (value: { efficacy: number | null; toxicity: number | null }) => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
  analyzeMolecule: (molecule: DrugMoleculeData, decryptedEfficacy: number | null, decryptedToxicity: number | null) => MoleculeAnalysis;
}> = ({ molecule, onClose, decryptedData, setDecryptedData, isDecrypting, decryptData, analyzeMolecule }) => {
  const handleDecrypt = async () => {
    if (decryptedData.efficacy !== null) { 
      setDecryptedData({ efficacy: null, toxicity: null }); 
      return; 
    }
    
    const decrypted = await decryptData();
    if (decrypted !== null) {
      setDecryptedData({ efficacy: decrypted, toxicity: decrypted });
    }
  };

  const analysis = analyzeMolecule(molecule, decryptedData.efficacy, decryptedData.toxicity);

  return (
    <div className="modal-overlay">
      <div className="molecule-detail-modal">
        <div className="modal-header">
          <h2>Molecular Analysis</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="molecule-info">
            <div className="info-item">
              <span>Molecule Name:</span>
              <strong>{molecule.name}</strong>
            </div>
            <div className="info-item">
              <span>Contributor:</span>
              <strong>{molecule.creator.substring(0, 6)}...{molecule.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date Added:</span>
              <strong>{new Date(molecule.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-item">
              <span>Public Toxicity Score:</span>
              <strong>{molecule.publicValue1}/10</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Efficacy Data</h3>
            
            <div className="data-row">
              <div className="data-label">Efficacy Score:</div>
              <div className="data-value">
                {molecule.isVerified && molecule.decryptedValue ? 
                  `${molecule.decryptedValue} (On-chain Verified)` : 
                  decryptedData.efficacy !== null ? 
                  `${decryptedData.efficacy} (Locally Decrypted)` : 
                  "🔒 FHE Encrypted Integer"
                }
              </div>
              <button 
                className={`decrypt-btn ${(molecule.isVerified || decryptedData.efficacy !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting}
              >
                {isDecrypting ? (
                  "🔓 Verifying..."
                ) : molecule.isVerified ? (
                  "✅ Verified"
                ) : decryptedData.efficacy !== null ? (
                  "🔄 Re-verify"
                ) : (
                  "🔓 Verify Decryption"
                )}
              </button>
            </div>
          </div>
          
          {(molecule.isVerified || decryptedData.efficacy !== null) && (
            <div className="analysis-section">
              <h3>Drug Development Analysis</h3>
              
              <div className="analysis-charts">
                <div className="chart-container">
                  <div className="chart-label">Efficacy Score</div>
                  <div className="chart-bar">
                    <div 
                      className="bar-fill efficacy" 
                      style={{ width: `${analysis.efficacyScore}%` }}
                    >
                      <span className="bar-value">{analysis.efficacyScore}</span>
                    </div>
                  </div>
                </div>
                
                <div className="chart-container">
                  <div className="chart-label">Safety Profile</div>
                  <div className="chart-bar">
                    <div 
                      className="bar-fill safety" 
                      style={{ width: `${analysis.safetyProfile}%` }}
                    >
                      <span className="bar-value">{analysis.safetyProfile}</span>
                    </div>
                  </div>
                </div>
                
                <div className="chart-container">
                  <div className="chart-label">Bioavailability</div>
                  <div className="chart-bar">
                    <div 
                      className="bar-fill bio" 
                      style={{ width: `${analysis.bioavailability}%` }}
                    >
                      <span className="bar-value">{analysis.bioavailability}</span>
                    </div>
                  </div>
                </div>
                
                <div className="chart-container">
                  <div className="chart-label">Synthesis Complexity</div>
                  <div className="chart-bar">
                    <div 
                      className="bar-fill complexity" 
                      style={{ width: `${analysis.synthesisComplexity}%` }}
                    >
                      <span className="bar-value">{analysis.synthesisComplexity}</span>
                    </div>
                  </div>
                </div>
                
                <div className="chart-container">
                  <div className="chart-label">Patent Potential</div>
                  <div className="chart-bar">
                    <div 
                      className="bar-fill patent" 
                      style={{ width: `${analysis.patentPotential}%` }}
                    >
                      <span className="bar-value">{analysis.patentPotential}</span>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="decrypted-values">
                <div className="value-item">
                  <span>Efficacy Score:</span>
                  <strong>
                    {molecule.isVerified ? 
                      `${molecule.decryptedValue} (On-chain Verified)` : 
                      `${decryptedData.efficacy} (Locally Decrypted)`
                    }
                  </strong>
                  <span className={`data-badge ${molecule.isVerified ? 'verified' : 'local'}`}>
                    {molecule.isVerified ? 'On-chain Verified' : 'Local Decryption'}
                  </span>
                </div>
                <div className="value-item">
                  <span>Toxicity Score:</span>
                  <strong>{molecule.publicValue1}/10</strong>
                  <span className="data-badge public">Public Data</span>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!molecule.isVerified && (
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting}
              className="verify-btn"
            >
              {isDecrypting ? "Verifying on-chain..." : "Verify on-chain"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


