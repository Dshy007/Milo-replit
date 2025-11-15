#!/usr/bin/env python3
"""
Excel Parser for Amazon Roster Files
Uses pandas for robust Excel parsing and validation
"""

import sys
import json
import pandas as pd
from datetime import datetime
from typing import Dict, List, Any

def parse_operator_id(operator_id: str) -> Dict[str, str]:
    """
    Parse operator ID format: FTIM_MKC_Solo2_Tractor_4_d2
    Returns: {site: 'MKC', type: 'solo2', tractor: '4'}
    """
    try:
        parts = operator_id.split('_')
        if len(parts) < 6:
            return {}
        
        return {
            'site': parts[1],
            'type': parts[2].lower(),
            'tractor': parts[4]
        }
    except Exception as e:
        return {}

def validate_row(row: pd.Series, row_num: int) -> Dict[str, Any]:
    """Validate a single row and extract key information"""
    errors = []
    warnings = []
    
    # Required fields
    required_fields = ['Block ID', 'Driver Name', 'Operator ID']
    for field in required_fields:
        if pd.isna(row.get(field)):
            errors.append(f"Missing {field}")
    
    # Parse operator ID
    operator_id = str(row.get('Operator ID', ''))
    parsed = parse_operator_id(operator_id)
    
    if not parsed:
        errors.append(f"Invalid Operator ID format: {operator_id}")
    
    # Validate dates
    stop1_arrival = row.get('Stop 1 Planned Arrival Date')
    stop1_departure = row.get('Stop 1 Planned Departure Date')
    
    if pd.isna(stop1_arrival):
        errors.append("Missing Stop 1 Arrival Date")
    if pd.isna(stop1_departure):
        errors.append("Missing Stop 1 Departure Date")
    
    return {
        'row_number': row_num,
        'valid': len(errors) == 0,
        'errors': errors,
        'warnings': warnings,
        'data': {
            'blockId': str(row.get('Block ID', '')),
            'driverName': str(row.get('Driver Name', '')),
            'operatorId': operator_id,
            'site': parsed.get('site', 'MKC'),
            'contractType': parsed.get('type', ''),
            'tractor': parsed.get('tractor', ''),
            'stop1Arrival': str(stop1_arrival) if not pd.isna(stop1_arrival) else None,
            'stop1Departure': str(stop1_departure) if not pd.isna(stop1_departure) else None,
            'stop1ArrivalTime': str(row.get('Stop 1 Planned Arrival Time', '')),
            'stop1DepartureTime': str(row.get('Stop 1 Planned Departure Time', '')),
            'stop2Arrival': str(row.get('Stop 2 Planned Arrival Date', '')) if not pd.isna(row.get('Stop 2 Planned Arrival Date')) else None,
            'stop2Departure': str(row.get('Stop 2 Planned Departure Date', '')) if not pd.isna(row.get('Stop 2 Planned Departure Date')) else None,
            'stop2ArrivalTime': str(row.get('Stop 2 Planned Arrival Time', '')),
            'stop2DepartureTime': str(row.get('Stop 2 Planned Departure Time', '')),
        }
    }

def parse_excel(file_path: str) -> Dict[str, Any]:
    """
    Parse Excel file and return structured data with validation
    """
    try:
        # Read Excel file
        df = pd.read_excel(file_path, engine='openpyxl')
        
        # Basic info
        result = {
            'success': True,
            'total_rows': len(df),
            'valid_rows': 0,
            'invalid_rows': 0,
            'rows': [],
            'summary': {
                'contract_types': {},
                'tractors': set(),
                'drivers': set(),
                'date_range': {}
            }
        }
        
        # Process each row
        for idx, row in df.iterrows():
            validated = validate_row(row, idx + 2)  # +2 for Excel row number (header + 1-indexed)
            result['rows'].append(validated)
            
            if validated['valid']:
                result['valid_rows'] += 1
                data = validated['data']
                
                # Update summary
                contract_type = data['contractType']
                if contract_type:
                    result['summary']['contract_types'][contract_type] = \
                        result['summary']['contract_types'].get(contract_type, 0) + 1
                
                if data['tractor']:
                    result['summary']['tractors'].add(data['tractor'])
                
                if data['driverName']:
                    result['summary']['drivers'].add(data['driverName'])
            else:
                result['invalid_rows'] += 1
        
        # Convert sets to lists for JSON serialization
        result['summary']['tractors'] = sorted(list(result['summary']['tractors']))
        result['summary']['drivers'] = sorted(list(result['summary']['drivers']))
        
        return result
        
    except Exception as e:
        return {
            'success': False,
            'error': str(e),
            'error_type': type(e).__name__
        }

if __name__ == '__main__':
    if len(sys.argv) != 2:
        print(json.dumps({'success': False, 'error': 'Usage: excel_parser.py <file_path>'}))
        sys.exit(1)
    
    file_path = sys.argv[1]
    result = parse_excel(file_path)
    print(json.dumps(result, indent=2))
