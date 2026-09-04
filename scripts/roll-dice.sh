#!/bin/bash

# D&D Dice Roller CLI Tool
# Usage: ./roll-dice.sh <dice-expression> [--label "description"] [--hidden]
# Examples:
#   ./roll-dice.sh 1d20+3 --label "Perception check"
#   ./roll-dice.sh 2d6+2 --label "Goblin damage" --hidden
#   ./roll-dice.sh 1d20 --advantage --label "Attack with advantage"
#   ./roll-dice.sh 1d20 --disadvantage --label "Attack with disadvantage"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Parse arguments
DICE_EXPR="$1"
shift

LABEL=""
HIDDEN=false
ADVANTAGE=false
DISADVANTAGE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --label)
            LABEL="$2"
            shift 2
            ;;
        --hidden)
            HIDDEN=true
            shift
            ;;
        --advantage)
            ADVANTAGE=true
            shift
            ;;
        --disadvantage)
            DISADVANTAGE=true
            shift
            ;;
        *)
            shift
            ;;
    esac
done

# Function to roll a single die
roll_die() {
    local sides=$1
    echo $((RANDOM % sides + 1))
}

# Function to parse and roll dice expression like "2d6+3" or "1d20"
roll_dice_expr() {
    local expr=$1

    # Extract number of dice, die size, and modifier
    if [[ $expr =~ ^([0-9]+)?d([0-9]+)([+-][0-9]+)?$ ]]; then
        local num_dice=${BASH_REMATCH[1]:-1}
        local die_size=${BASH_REMATCH[2]}
        local modifier=${BASH_REMATCH[3]:-+0}

        local total=0
        local rolls=()

        # Roll each die
        for ((i=1; i<=num_dice; i++)); do
            local roll=$(roll_die $die_size)
            rolls+=($roll)
            total=$((total + roll))
        done

        # Apply modifier
        local mod_value=${modifier:1}  # Remove +/- sign
        if [[ ${modifier:0:1} == "+" ]]; then
            total=$((total + mod_value))
        else
            total=$((total - mod_value))
        fi

        # Return results as JSON-like format
        echo "ROLLS:[${rolls[*]}]|MODIFIER:$modifier|TOTAL:$total|EXPR:$expr"
    else
        echo "ERROR: Invalid dice expression: $expr"
        exit 1
    fi
}

# Handle advantage/disadvantage (only for d20 rolls)
if [[ $ADVANTAGE == true ]] || [[ $DISADVANTAGE == true ]]; then
    if [[ ! $DICE_EXPR =~ ^1?d20 ]]; then
        echo "ERROR: Advantage/Disadvantage only works with d20 rolls"
        exit 1
    fi

    # Roll twice
    result1=$(roll_dice_expr "$DICE_EXPR")
    result2=$(roll_dice_expr "$DICE_EXPR")

    total1=$(echo "$result1" | sed -n 's/.*TOTAL:\([0-9]*\).*/\1/p')
    total2=$(echo "$result2" | sed -n 's/.*TOTAL:\([0-9]*\).*/\1/p')

    rolls1=$(echo "$result1" | sed -n 's/.*ROLLS:\[\([^]]*\)\].*/\1/p')
    rolls2=$(echo "$result2" | sed -n 's/.*ROLLS:\[\([^]]*\)\].*/\1/p')

    if [[ $ADVANTAGE == true ]]; then
        if [[ $total1 -ge $total2 ]]; then
            final_total=$total1
            final_rolls=$rolls1
            dropped=$rolls2
        else
            final_total=$total2
            final_rolls=$rolls2
            dropped=$rolls1
        fi
        adv_label="ADVANTAGE"
    else
        if [[ $total1 -le $total2 ]]; then
            final_total=$total1
            final_rolls=$rolls1
            dropped=$rolls2
        else
            final_total=$total2
            final_rolls=$rolls2
            dropped=$rolls1
        fi
        adv_label="DISADVANTAGE"
    fi

    if [[ $HIDDEN == false ]]; then
        echo -e "${CYAN}🎲 Rolling with $adv_label${NC}"
        if [[ -n $LABEL ]]; then
            echo -e "${BLUE}   $LABEL${NC}"
        fi
        echo -e "   Roll 1: [$rolls1] = ${YELLOW}$total1${NC}"
        echo -e "   Roll 2: [$rolls2] = ${YELLOW}$total2${NC}"
        echo -e "   ${GREEN}Final Result: $final_total${NC} (dropped: $dropped)"
    fi

    # Output for parsing
    echo "FINAL:$final_total|EXPR:$DICE_EXPR|LABEL:$LABEL|ADV:$adv_label"
else
    # Normal roll
    result=$(roll_dice_expr "$DICE_EXPR")

    if [[ $result == ERROR* ]]; then
        echo "$result"
        exit 1
    fi

    rolls=$(echo "$result" | sed -n 's/.*ROLLS:\[\([^]]*\)\].*/\1/p')
    modifier=$(echo "$result" | sed -n 's/.*MODIFIER:\([^|]*\).*/\1/p')
    total=$(echo "$result" | sed -n 's/.*TOTAL:\([0-9]*\).*/\1/p')

    if [[ $HIDDEN == false ]]; then
        echo -e "${CYAN}🎲 Rolling $DICE_EXPR${NC}"
        if [[ -n $LABEL ]]; then
            echo -e "${BLUE}   $LABEL${NC}"
        fi
        echo -e "   Dice: [${rolls// /, }]"
        if [[ $modifier != "+0" ]]; then
            echo -e "   Modifier: $modifier"
        fi
        echo -e "   ${GREEN}Total: $total${NC}"
    fi

    # Output for parsing
    echo "FINAL:$total|EXPR:$DICE_EXPR|LABEL:$LABEL|ROLLS:[$rolls]|MODIFIER:$modifier"
fi

exit 0
