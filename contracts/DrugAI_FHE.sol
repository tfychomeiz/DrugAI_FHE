pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract DrugDiscoveryFHE is ZamaEthereumConfig {
    struct EncryptedMolecule {
        string moleculeId;
        euint32 encryptedStructure;
        uint256 publicProperty1;
        uint256 publicProperty2;
        string description;
        address submitter;
        uint256 timestamp;
        uint32 decryptedValue;
        bool isVerified;
    }

    mapping(string => EncryptedMolecule) public encryptedMolecules;
    string[] public moleculeIds;

    event MoleculeRegistered(string indexed moleculeId, address indexed submitter);
    event DecryptionVerified(string indexed moleculeId, uint32 decryptedValue);

    constructor() ZamaEthereumConfig() {}

    function registerMolecule(
        string calldata moleculeId,
        string calldata name,
        externalEuint32 encryptedStructure,
        bytes calldata inputProof,
        uint256 publicProperty1,
        uint256 publicProperty2,
        string calldata description
    ) external {
        require(bytes(encryptedMolecules[moleculeId].moleculeId).length == 0, "Molecule already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedStructure, inputProof)), "Invalid encrypted input");

        encryptedMolecules[moleculeId] = EncryptedMolecule({
            moleculeId: name,
            encryptedStructure: FHE.fromExternal(encryptedStructure, inputProof),
            publicProperty1: publicProperty1,
            publicProperty2: publicProperty2,
            description: description,
            submitter: msg.sender,
            timestamp: block.timestamp,
            decryptedValue: 0,
            isVerified: false
        });

        FHE.allowThis(encryptedMolecules[moleculeId].encryptedStructure);
        FHE.makePubliclyDecryptable(encryptedMolecules[moleculeId].encryptedStructure);

        moleculeIds.push(moleculeId);
        emit MoleculeRegistered(moleculeId, msg.sender);
    }

    function verifyMoleculeDecryption(
        string calldata moleculeId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(encryptedMolecules[moleculeId].moleculeId).length > 0, "Molecule does not exist");
        require(!encryptedMolecules[moleculeId].isVerified, "Molecule already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(encryptedMolecules[moleculeId].encryptedStructure);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));

        encryptedMolecules[moleculeId].decryptedValue = decodedValue;
        encryptedMolecules[moleculeId].isVerified = true;
        emit DecryptionVerified(moleculeId, decodedValue);
    }

    function getEncryptedStructure(string calldata moleculeId) external view returns (euint32) {
        require(bytes(encryptedMolecules[moleculeId].moleculeId).length > 0, "Molecule does not exist");
        return encryptedMolecules[moleculeId].encryptedStructure;
    }

    function getMoleculeData(string calldata moleculeId) external view returns (
        string memory name,
        uint256 publicProperty1,
        uint256 publicProperty2,
        string memory description,
        address submitter,
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedValue
    ) {
        require(bytes(encryptedMolecules[moleculeId].moleculeId).length > 0, "Molecule does not exist");
        EncryptedMolecule storage data = encryptedMolecules[moleculeId];
        
        return (
            data.moleculeId,
            data.publicProperty1,
            data.publicProperty2,
            data.description,
            data.submitter,
            data.timestamp,
            data.isVerified,
            data.decryptedValue
        );
    }

    function getAllMoleculeIds() external view returns (string[] memory) {
        return moleculeIds;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


