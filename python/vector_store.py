#!/usr/bin/env python3
"""
Vector Store for Driver Assignment Patterns using ChromaDB

This module provides semantic search capabilities for finding similar:
- Driver-block assignment patterns
- Time slot preferences
- Route characteristics

Future expansions:
- Driver performance embeddings
- Route complexity scores
- Delivery location clustering
- Historical success patterns
"""

import sys
import json
import os
from typing import Dict, List, Any, Optional
from datetime import datetime

import chromadb
from chromadb.config import Settings


class DriverVectorStore:
    """
    Vector database for storing and querying driver assignment patterns.

    Collections:
    1. driver_patterns - Historical driver-block assignments as embeddings
    2. block_characteristics - Block metadata (times, routes, complexity)
    3. driver_profiles - Driver preferences and performance patterns
    """

    def __init__(self, persist_directory: str = None):
        """Initialize ChromaDB with persistent storage"""
        if persist_directory is None:
            # Default to a data directory in the project
            persist_directory = os.path.join(os.path.dirname(__file__), '..', 'data', 'chromadb')

        # Ensure directory exists
        os.makedirs(persist_directory, exist_ok=True)

        # Initialize ChromaDB with persistent storage
        self.client = chromadb.PersistentClient(
            path=persist_directory,
            settings=Settings(
                anonymized_telemetry=False,
                allow_reset=True
            )
        )

        # Get or create collections
        self._init_collections()

    def _init_collections(self):
        """Initialize all collections"""
        # Driver assignment patterns - stores historical assignments
        self.patterns_collection = self.client.get_or_create_collection(
            name="driver_patterns",
            metadata={"description": "Historical driver-block assignment patterns"}
        )

        # Block characteristics - stores block metadata
        self.blocks_collection = self.client.get_or_create_collection(
            name="block_characteristics",
            metadata={"description": "Block metadata and characteristics"}
        )

        # Driver profiles - stores driver preferences and stats
        self.drivers_collection = self.client.get_or_create_collection(
            name="driver_profiles",
            metadata={"description": "Driver preferences and performance patterns"}
        )

    def add_assignment_pattern(self,
                               driver_id: str,
                               block_id: str,
                               service_date: str,
                               day_of_week: int,
                               start_time: str,
                               end_time: str = None,
                               contract_type: str = None,
                               metadata: Dict = None) -> str:
        """
        Add a driver-block assignment pattern to the vector store.

        The document text is a structured representation that will be embedded.
        """
        # Create a unique ID for this assignment
        doc_id = f"{driver_id}_{block_id}_{service_date}"

        # Create document text for embedding
        # This text will be converted to a vector for similarity search
        document = f"Driver {driver_id} assigned to block {block_id} on {self._day_name(day_of_week)} at {start_time}"
        if contract_type:
            document += f" for {contract_type} contract"

        # Metadata for filtering
        pattern_metadata = {
            "driver_id": driver_id,
            "block_id": block_id,
            "service_date": service_date,
            "day_of_week": day_of_week,
            "start_time": start_time,
            "contract_type": contract_type or "unknown",
            "added_at": datetime.now().isoformat()
        }

        if end_time:
            pattern_metadata["end_time"] = end_time

        if metadata:
            pattern_metadata.update(metadata)

        # Add to collection
        self.patterns_collection.upsert(
            ids=[doc_id],
            documents=[document],
            metadatas=[pattern_metadata]
        )

        return doc_id

    def add_block_characteristics(self,
                                  block_id: str,
                                  contract_type: str,
                                  typical_start_time: str,
                                  typical_end_time: str,
                                  day_of_week: int = None,
                                  metadata: Dict = None) -> str:
        """Add block characteristics for similarity matching"""
        document = f"Block {block_id} is a {contract_type} route starting at {typical_start_time}"
        if day_of_week is not None:
            document += f" on {self._day_name(day_of_week)}"

        block_metadata = {
            "block_id": block_id,
            "contract_type": contract_type,
            "typical_start_time": typical_start_time,
            "typical_end_time": typical_end_time,
            "day_of_week": day_of_week,
            "updated_at": datetime.now().isoformat()
        }

        if metadata:
            block_metadata.update(metadata)

        self.blocks_collection.upsert(
            ids=[block_id],
            documents=[document],
            metadatas=[block_metadata]
        )

        return block_id

    def add_driver_profile(self,
                          driver_id: str,
                          name: str,
                          solo_type: str,
                          preferred_days: List[int] = None,
                          preferred_times: List[str] = None,
                          metadata: Dict = None) -> str:
        """Add or update driver profile"""
        document = f"Driver {name} ({driver_id}) is a {solo_type} driver"
        if preferred_days:
            day_names = [self._day_name(d) for d in preferred_days]
            document += f" who prefers {', '.join(day_names)}"
        if preferred_times:
            document += f" during {', '.join(preferred_times)} shifts"

        driver_metadata = {
            "driver_id": driver_id,
            "name": name,
            "solo_type": solo_type,
            "preferred_days": json.dumps(preferred_days or []),
            "preferred_times": json.dumps(preferred_times or []),
            "updated_at": datetime.now().isoformat()
        }

        if metadata:
            driver_metadata.update(metadata)

        self.drivers_collection.upsert(
            ids=[driver_id],
            documents=[document],
            metadatas=[driver_metadata]
        )

        return driver_id

    def find_similar_assignments(self,
                                 block_id: str = None,
                                 day_of_week: int = None,
                                 start_time: str = None,
                                 contract_type: str = None,
                                 n_results: int = 10) -> List[Dict]:
        """
        Find drivers with similar assignment patterns.

        Uses semantic search to find drivers who have been assigned to:
        - The same block
        - Similar time slots
        - Similar contract types
        """
        # Build query text
        query_parts = []
        if block_id:
            query_parts.append(f"block {block_id}")
        if day_of_week is not None:
            query_parts.append(f"on {self._day_name(day_of_week)}")
        if start_time:
            query_parts.append(f"at {start_time}")
        if contract_type:
            query_parts.append(f"for {contract_type} contract")

        if not query_parts:
            return []

        query = "Assignment pattern: " + " ".join(query_parts)

        # Build where filter for metadata
        where_filter = {}
        if contract_type:
            where_filter["contract_type"] = contract_type

        # Query the collection
        try:
            results = self.patterns_collection.query(
                query_texts=[query],
                n_results=n_results,
                where=where_filter if where_filter else None
            )

            # Format results
            matches = []
            if results and results['ids'] and results['ids'][0]:
                for i, doc_id in enumerate(results['ids'][0]):
                    match = {
                        'id': doc_id,
                        'document': results['documents'][0][i] if results['documents'] else None,
                        'metadata': results['metadatas'][0][i] if results['metadatas'] else {},
                        'distance': results['distances'][0][i] if results.get('distances') else None
                    }
                    matches.append(match)

            return matches
        except Exception as e:
            print(f"Error querying patterns: {e}", file=sys.stderr)
            return []

    def find_similar_blocks(self,
                           block_id: str,
                           n_results: int = 5) -> List[Dict]:
        """Find blocks similar to the given block"""
        try:
            # First get the block's info
            block_info = self.blocks_collection.get(ids=[block_id])

            if not block_info or not block_info['documents']:
                return []

            # Query for similar blocks
            results = self.blocks_collection.query(
                query_texts=block_info['documents'],
                n_results=n_results + 1  # +1 because it will match itself
            )

            # Format and exclude self
            matches = []
            if results and results['ids'] and results['ids'][0]:
                for i, doc_id in enumerate(results['ids'][0]):
                    if doc_id != block_id:  # Exclude self
                        match = {
                            'block_id': doc_id,
                            'document': results['documents'][0][i] if results['documents'] else None,
                            'metadata': results['metadatas'][0][i] if results['metadatas'] else {},
                            'distance': results['distances'][0][i] if results.get('distances') else None
                        }
                        matches.append(match)

            return matches[:n_results]
        except Exception as e:
            print(f"Error finding similar blocks: {e}", file=sys.stderr)
            return []

    def get_driver_history(self, driver_id: str) -> List[Dict]:
        """Get all assignment history for a specific driver"""
        try:
            results = self.patterns_collection.get(
                where={"driver_id": driver_id}
            )

            if not results or not results['ids']:
                return []

            history = []
            for i, doc_id in enumerate(results['ids']):
                record = {
                    'id': doc_id,
                    'document': results['documents'][i] if results['documents'] else None,
                    'metadata': results['metadatas'][i] if results['metadatas'] else {}
                }
                history.append(record)

            return history
        except Exception as e:
            print(f"Error getting driver history: {e}", file=sys.stderr)
            return []

    def bulk_add_historical_data(self, records: List[Dict]) -> Dict[str, int]:
        """
        Bulk import historical assignment data.

        Each record should have:
        - driverId
        - blockId
        - serviceDate
        - dayOfWeek
        - startTime
        - contractType (optional)
        """
        added = 0
        skipped = 0
        errors = 0

        for record in records:
            try:
                driver_id = record.get('driverId')
                block_id = record.get('blockId')
                service_date = record.get('serviceDate')
                day_of_week = record.get('dayOfWeek')
                start_time = record.get('startTime')

                if not all([driver_id, block_id, service_date]):
                    skipped += 1
                    continue

                self.add_assignment_pattern(
                    driver_id=str(driver_id),
                    block_id=str(block_id),
                    service_date=str(service_date),
                    day_of_week=int(day_of_week) if day_of_week is not None else 0,
                    start_time=str(start_time) if start_time else "00:00",
                    contract_type=record.get('contractType')
                )
                added += 1
            except Exception as e:
                errors += 1
                print(f"Error adding record: {e}", file=sys.stderr)

        return {
            'added': added,
            'skipped': skipped,
            'errors': errors,
            'total': len(records)
        }

    def get_stats(self) -> Dict[str, Any]:
        """Get statistics about the vector store"""
        return {
            'patterns_count': self.patterns_collection.count(),
            'blocks_count': self.blocks_collection.count(),
            'drivers_count': self.drivers_collection.count()
        }

    def reset_all(self):
        """Reset all collections (use with caution!)"""
        self.client.delete_collection("driver_patterns")
        self.client.delete_collection("block_characteristics")
        self.client.delete_collection("driver_profiles")
        self._init_collections()

    @staticmethod
    def _day_name(day_of_week: int) -> str:
        """Convert day number to name (0=Sunday)"""
        days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
        return days[day_of_week % 7]


def main():
    """Main entry point for CLI usage"""
    if len(sys.argv) < 2:
        # Read from stdin
        input_str = sys.stdin.read()
        if not input_str.strip():
            print(json.dumps({'success': False, 'error': 'No input provided'}))
            return
        data = json.loads(input_str)
    else:
        data = json.loads(sys.argv[1])

    action = data.get('action', 'stats')
    store = DriverVectorStore()

    try:
        if action == 'stats':
            result = store.get_stats()
            print(json.dumps({'success': True, 'stats': result}))

        elif action == 'add_pattern':
            doc_id = store.add_assignment_pattern(
                driver_id=data['driver_id'],
                block_id=data['block_id'],
                service_date=data['service_date'],
                day_of_week=data.get('day_of_week', 0),
                start_time=data.get('start_time', '00:00'),
                contract_type=data.get('contract_type')
            )
            print(json.dumps({'success': True, 'id': doc_id}))

        elif action == 'bulk_import':
            records = data.get('records', [])
            result = store.bulk_add_historical_data(records)
            print(json.dumps({'success': True, 'result': result}))

        elif action == 'find_similar':
            matches = store.find_similar_assignments(
                block_id=data.get('block_id'),
                day_of_week=data.get('day_of_week'),
                start_time=data.get('start_time'),
                contract_type=data.get('contract_type'),
                n_results=data.get('n_results', 10)
            )
            print(json.dumps({'success': True, 'matches': matches}))

        elif action == 'driver_history':
            history = store.get_driver_history(data['driver_id'])
            print(json.dumps({'success': True, 'history': history}))

        elif action == 'reset':
            store.reset_all()
            print(json.dumps({'success': True, 'message': 'All collections reset'}))

        else:
            print(json.dumps({'success': False, 'error': f'Unknown action: {action}'}))

    except Exception as e:
        import traceback
        print(json.dumps({
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc()
        }))


if __name__ == '__main__':
    main()
